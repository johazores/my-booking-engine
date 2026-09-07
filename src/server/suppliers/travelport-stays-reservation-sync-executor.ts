import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  buildTravelportStaysReservationSyncRequest,
  classifyTravelportStaysReservationSyncOutcome,
  type TravelportStaysReservationSyncOutcome,
} from './travelport-stays-reservation-sync-domain.ts';
import type { TravelportStaysCreateExpectedReservation } from './travelport-stays-reservation-create-outcome.ts';
import type { NormalizedHospitalitySupplierReservationTravelerPayload } from './hospitality-supplier-reservation-traveler-authority.ts';
import {
  requestTravelportStaysAccessToken,
  type TravelportStaysCredentials,
} from './travelport-stays-provider.ts';

const ENDPOINTS = Object.freeze({
  'pre-production': 'https://api.pp.travelport.net/11/hotel/',
  production: 'https://api.travelport.net/11/hotel/',
});
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CACHE_KEY_LENGTH = 512;
const SF_TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenCache = new Map<string, Readonly<{ accessToken: string; expiresAtMs: number }>>();
const tokenRequests = new Map<string, Promise<string>>();

function invalidRequest(message = 'Travelport reservation Sync request is invalid.'): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', message);
}

function boundedSingleLine(value: unknown, label: string, max: number) {
  if (typeof value !== 'string') invalidRequest(`${label} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized !== value || normalized.length > max || /[\r\n]/.test(normalized)) {
    invalidRequest(`${label} is invalid.`);
  }
  return normalized;
}

function normalizeTimeout(value: number | undefined) {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    invalidRequest('Travelport reservation Sync timeout is invalid.');
  }
  return timeoutMs;
}

function ambiguousTransportFailure(): TravelportStaysReservationSyncOutcome {
  return Object.freeze({
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    providerCorrelationId: null,
  });
}

export class TravelportStaysReservationSyncExecutor {
  readonly #credentials: TravelportStaysCredentials;
  readonly #cacheKey: string;
  readonly #fetchImpl: typeof fetch;
  readonly #timeoutMs: number;
  readonly #now: () => Date;

  constructor(input: Readonly<{
    credentials: TravelportStaysCredentials;
    cacheKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  }>) {
    this.#cacheKey = boundedSingleLine(input.cacheKey, 'Travelport reservation Sync cache key', MAX_CACHE_KEY_LENGTH);
    this.#credentials = input.credentials;
    this.#fetchImpl = input.fetchImpl ?? fetch;
    this.#timeoutMs = normalizeTimeout(input.timeoutMs);
    this.#now = input.now ?? (() => new Date());
  }

  async #accessToken() {
    const nowMs = this.#now().getTime();
    const cached = tokenCache.get(this.#cacheKey);
    if (cached && cached.expiresAtMs > nowMs) return cached.accessToken;
    const pending = tokenRequests.get(this.#cacheKey);
    if (pending) return pending;
    const request = requestTravelportStaysAccessToken({
      credentials: this.#credentials,
      fetchImpl: this.#fetchImpl,
      timeoutMs: this.#timeoutMs,
      nowMs,
    }).then((token) => {
      tokenCache.set(this.#cacheKey, token);
      return token.accessToken;
    }).finally(() => tokenRequests.delete(this.#cacheKey));
    tokenRequests.set(this.#cacheKey, request);
    return request;
  }

  async syncReservation(input: Readonly<{
    requestCorrelationId: string;
    providerRecoveryReference: string;
    supplierConfirmationReference: string;
    traveler: NormalizedHospitalitySupplierReservationTravelerPayload;
    expectedReservation: TravelportStaysCreateExpectedReservation;
    beforeProviderRequest: () => Promise<void>;
  }>): Promise<TravelportStaysReservationSyncOutcome> {
    if (!SF_TRACE_ID_PATTERN.test(input.requestCorrelationId)) {
      invalidRequest('Travelport reservation Sync correlation ID is invalid.');
    }
    if (typeof input.beforeProviderRequest !== 'function') {
      invalidRequest('Travelport reservation Sync provider-request marker is required.');
    }

    let requestBody;
    try {
      requestBody = buildTravelportStaysReservationSyncRequest({
        providerRecoveryReference: input.providerRecoveryReference,
        supplierConfirmationReference: input.supplierConfirmationReference,
        traveler: input.traveler,
      });
    } catch {
      invalidRequest('Travelport reservation Sync recovery authority is invalid.');
    }

    const accessToken = await this.#accessToken();
    const serializedBody = JSON.stringify(requestBody);

    // All deterministic request construction and OAuth complete before the durable marker.
    // After this point any transport uncertainty must remain ambiguous and must not authorize
    // another Sync write automatically.
    await input.beforeProviderRequest();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetchImpl(`${ENDPOINTS[this.#credentials.environment]}book/reservations/`, {
        method: 'POST',
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache',
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          XAUTH_TRAVELPORT_ACCESSGROUP: this.#credentials.accessGroup,
          E2ETrackingID: `sf-${input.requestCorrelationId}`,
          username: this.#credentials.username,
          password: this.#credentials.password,
          client_id: this.#credentials.clientId,
          client_secret: this.#credentials.clientSecret,
        },
        body: serializedBody,
      });
    } catch {
      return ambiguousTransportFailure();
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) tokenCache.delete(this.#cacheKey);
    const body = await response.json().catch(() => null);
    return classifyTravelportStaysReservationSyncOutcome({
      httpStatus: response.status,
      body,
      expectedReservation: input.expectedReservation,
      supplierConfirmationReference: input.supplierConfirmationReference,
    });
  }
}
