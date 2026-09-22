import { HospitalitySupplierProviderError, type HospitalitySupplierFailureCode } from './hospitality-supplier-provider.ts';
import { throwHospitalitySupplierTransportFailure } from './hospitality-supplier-transport-failure.ts';
import type {
  HospitalitySupplierReservationRecoveryProvider,
  HospitalitySupplierReservationRecoveryRequest,
  HospitalitySupplierReservationRecoveryResult,
} from './hospitality-supplier-reservation-recovery-provider.ts';
import { materializeTravelportStaysReservationIoConstructorAuthority } from './travelport-stays-constructor-authority.ts';
import {
  normalizeTravelportStaysReservationExpectation,
} from './travelport-stays-reservation-identity.ts';
import { materializeTravelportStaysReservationOperationInput } from './travelport-stays-reservation-operation-input-authority.ts';
import { normalizeTravelportStaysReservationReference } from './travelport-stays-reservation-reference.ts';
import {
  parseTravelportStaysReservationResponse,
} from './travelport-stays-reservation-response.ts';
import {
  requestTravelportStaysAccessToken,
  type TravelportStaysCredentials,
} from './travelport-stays-provider.ts';
import { assertTravelportStaysTransportRequestReady } from './travelport-stays-transport-preflight.ts';

const ENDPOINTS = Object.freeze({
  'pre-production': 'https://api.pp.travelport.net/11/hotel/',
  production: 'https://api.travelport.net/11/hotel/',
});

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CACHE_KEY_LENGTH = 512;
const MAX_REQUEST_CORRELATION_ID_LENGTH = 120;
const ASCII_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const tokenCache = new Map<string, Readonly<{ accessToken: string; expiresAtMs: number }>>();
const tokenRequests = new Map<string, Promise<string>>();
const RECOVERY_OPERATION_FIELDS = Object.freeze([
  'providerReservationReference',
  'requestCorrelationId',
  'expectedReservation',
  'beforeProviderRequest',
] as const);
const RECOVERY_OPERATION_MATERIALIZATION_FAILURE = 'Travelport reservation recovery operation authority could not be materialized safely.';

function normalizeTimeout(value: number | undefined) {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport timeout is invalid.');
  }
  return timeoutMs;
}

function boundedSingleLine(value: unknown, label: string, max: number) {
  if (typeof value !== 'string') throw new HospitalitySupplierProviderError('INVALID_REQUEST', `${label} is required.`);
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || normalized.length > max
    || !normalized.isWellFormed()
    || ASCII_CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return normalized;
}

function failureCodeForStatus(status: number): HospitalitySupplierFailureCode {
  if (status === 401 || status === 403) return 'AUTHENTICATION_FAILED';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'INVALID_RESPONSE';
}

async function fetchWithTimeout(input: {
  fetchImpl: typeof fetch;
  url: string;
  init: RequestInit;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    return await input.fetchImpl(input.url, { ...input.init, redirect: 'manual', signal: controller.signal });
  } catch (error) {
    throwHospitalitySupplierTransportFailure(error, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export class TravelportStaysReservationRecoveryProvider implements HospitalitySupplierReservationRecoveryProvider {
  readonly code = 'travelport-stays';
  readonly requiresSupplierConfirmationForFound = true;
  readonly supportsAuthoritativeNotFound = false;
  readonly #credentials: TravelportStaysCredentials;
  readonly #cacheKey: string;
  readonly #fetchImpl: typeof fetch;
  readonly #timeoutMs: number;
  readonly #now: () => Date;

  constructor(input: {
    credentials: TravelportStaysCredentials;
    cacheKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  }) {
    const authority = materializeTravelportStaysReservationIoConstructorAuthority(input);
    this.#credentials = authority.credentials;
    this.#cacheKey = boundedSingleLine(
      authority.cacheKey,
      'Travelport reservation recovery cache key',
      MAX_CACHE_KEY_LENGTH,
    );
    this.#fetchImpl = authority.fetchImpl ?? fetch;
    this.#timeoutMs = normalizeTimeout(authority.timeoutMs);
    this.#now = authority.now ?? (() => new Date());
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

  #headers(accessToken: string, requestCorrelationId: string) {
    return {
      'Accept-Encoding': 'gzip, deflate',
      'Cache-Control': 'no-cache',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      XAUTH_TRAVELPORT_ACCESSGROUP: this.#credentials.accessGroup,
      E2ETrackingID: `sf-${requestCorrelationId}`,
      TraceId: requestCorrelationId,
      username: this.#credentials.username,
      password: this.#credentials.password,
      client_id: this.#credentials.clientId,
      client_secret: this.#credentials.clientSecret,
    } as const;
  }

  async retrieveReservation(input: HospitalitySupplierReservationRecoveryRequest): Promise<HospitalitySupplierReservationRecoveryResult> {
    const authority = materializeTravelportStaysReservationOperationInput(
      input,
      RECOVERY_OPERATION_FIELDS,
      RECOVERY_OPERATION_MATERIALIZATION_FAILURE,
    );
    const reference = normalizeTravelportStaysReservationReference(authority.providerReservationReference);
    const requestCorrelationId = boundedSingleLine(
      authority.requestCorrelationId,
      'Request correlation ID',
      MAX_REQUEST_CORRELATION_ID_LENGTH,
    );
    const expectedReservation = normalizeTravelportStaysReservationExpectation(authority.expectedReservation);
    const beforeProviderRequest = authority.beforeProviderRequest;
    if (typeof beforeProviderRequest !== 'function') {
      throw new HospitalitySupplierProviderError(
        'INVALID_REQUEST',
        'Travelport reservation recovery provider-request marker is required.',
      );
    }

    const reservationUrl = `${ENDPOINTS[this.#credentials.environment]}book/reservations/${encodeURIComponent(reference)}`;
    const accessToken = await this.#accessToken();
    const requestHeaders = this.#headers(accessToken, requestCorrelationId);

    await assertTravelportStaysTransportRequestReady({
      credentials: this.#credentials,
      requestInput: reservationUrl,
      init: {
        method: 'GET',
        cache: 'no-store',
        redirect: 'manual',
        headers: requestHeaders,
      },
    });

    // Match the Create/Sync boundary: deterministic validation, OAuth, and exact transport-policy
    // preflight must finish before durable evidence says provider I/O may have started.
    await beforeProviderRequest();

    const response = await fetchWithTimeout({
      fetchImpl: this.#fetchImpl,
      url: reservationUrl,
      timeoutMs: this.#timeoutMs,
      init: {
        method: 'GET',
        cache: 'no-store',
        headers: requestHeaders,
      },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) tokenCache.delete(this.#cacheKey);
      throw new HospitalitySupplierProviderError(failureCodeForStatus(response.status));
    }

    const payload = await response.json().catch(() => null);
    const parsed = parseTravelportStaysReservationResponse(payload, {
      expectedProviderReservationReference: reference,
      expectedReservation,
      requireConfirmedTravelportReceipt: true,
    });
    return Object.freeze({
      status: 'FOUND',
      providerReservationReference: parsed.providerReservationReference,
      supplierConfirmationReference: parsed.supplierConfirmationReference,
      providerCorrelationId: parsed.providerCorrelationId,
    });
  }
}
