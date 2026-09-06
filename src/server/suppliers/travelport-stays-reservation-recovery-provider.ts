import { HospitalitySupplierProviderError, type HospitalitySupplierFailureCode } from './hospitality-supplier-provider.ts';
import type {
  HospitalitySupplierReservationRecoveryExpectation,
  HospitalitySupplierReservationRecoveryProvider,
  HospitalitySupplierReservationRecoveryRequest,
  HospitalitySupplierReservationRecoveryResult,
} from './hospitality-supplier-reservation-recovery-provider.ts';
import {
  parseTravelportStaysReservationResponse,
  type TravelportStaysReservationRecoveryExpectation,
} from './travelport-stays-reservation-response.ts';
import {
  requestTravelportStaysAccessToken,
  type TravelportStaysCredentials,
} from './travelport-stays-provider.ts';

const ENDPOINTS = Object.freeze({
  'pre-production': 'https://api.pp.travelport.net/11/hotel/',
  production: 'https://api.travelport.net/11/hotel/',
});

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REFERENCE_LENGTH = 512;
const MAX_SUPPLIER_PROPERTY_REFERENCE_LENGTH = 4_096;
const MAX_REQUEST_CORRELATION_ID_LENGTH = 120;
const tokenCache = new Map<string, Readonly<{ accessToken: string; expiresAtMs: number }>>();
const tokenRequests = new Map<string, Promise<string>>();

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
  if (!normalized || normalized.length > max || /[\r\n]/.test(normalized)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return normalized;
}

function localDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', `${label} is invalid.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return value;
}

function decodePropertyReference(value: unknown) {
  const encoded = boundedSingleLine(
    value,
    'Supplier property reference',
    MAX_SUPPLIER_PROPERTY_REFERENCE_LENGTH,
  );
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier property reference is invalid.');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier property reference is invalid.');
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier property reference is invalid.');
  }
  const identity = decoded as Record<string, unknown>;
  const chainCode = typeof identity.chainCode === 'string' ? identity.chainCode.trim() : '';
  const propertyCode = typeof identity.propertyCode === 'string' ? identity.propertyCode.trim() : '';
  if (
    identity.authority !== 'TVPT'
    || !/^[A-Za-z0-9]{1,16}$/.test(chainCode)
    || !/^[A-Za-z0-9]{1,32}$/.test(propertyCode)
  ) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier property reference is invalid.');
  }
  return Object.freeze({ chainCode, propertyCode });
}

function normalizeExpectedReservation(
  input: HospitalitySupplierReservationRecoveryExpectation | undefined,
): TravelportStaysReservationRecoveryExpectation {
  if (!input || typeof input !== 'object') {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Expected reservation evidence is required.');
  }
  const property = decodePropertyReference(input.supplierPropertyReference);
  const arrivalDateLocal = localDate(input.arrivalDateLocal, 'Arrival date');
  const departureDateLocal = localDate(input.departureDateLocal, 'Departure date');
  if (!Array.isArray(input.childAges)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Expected reservation child ages are invalid.');
  }
  const childAges = [...input.childAges];
  if (
    departureDateLocal <= arrivalDateLocal
    || input.rooms !== 1
    || !Number.isInteger(input.adults)
    || input.adults < 1
    || childAges.length > 8
    || childAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17)
    || input.adults + childAges.length > 9
  ) {
    throw new HospitalitySupplierProviderError(
      'INVALID_REQUEST',
      'Travelport reservation recovery supports the current single-room one-to-nine-guest contract only.',
    );
  }
  return Object.freeze({
    ...property,
    arrivalDateLocal,
    departureDateLocal,
    rooms: input.rooms,
    guests: input.adults + childAges.length,
  });
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
  } catch {
    throw new HospitalitySupplierProviderError(controller.signal.aborted ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

export class TravelportStaysReservationRecoveryProvider implements HospitalitySupplierReservationRecoveryProvider {
  readonly code = 'travelport-stays';
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
    if (!input.cacheKey || input.cacheKey.length > 512 || /[\r\n]/.test(input.cacheKey)) {
      throw new HospitalitySupplierProviderError('INVALID_REQUEST');
    }
    this.#credentials = input.credentials;
    this.#cacheKey = input.cacheKey;
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
    const reference = boundedSingleLine(
      input.providerReservationReference,
      'Provider reservation reference',
      MAX_REFERENCE_LENGTH,
    );
    const requestCorrelationId = boundedSingleLine(
      input.requestCorrelationId,
      'Request correlation ID',
      MAX_REQUEST_CORRELATION_ID_LENGTH,
    );
    const expectedReservation = normalizeExpectedReservation(input.expectedReservation);
    const response = await fetchWithTimeout({
      fetchImpl: this.#fetchImpl,
      url: `${ENDPOINTS[this.#credentials.environment]}book/reservations/${encodeURIComponent(reference)}`,
      timeoutMs: this.#timeoutMs,
      init: {
        method: 'GET',
        cache: 'no-store',
        headers: this.#headers(await this.#accessToken(), requestCorrelationId),
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
    });
    return Object.freeze({
      status: 'FOUND',
      providerReservationReference: parsed.providerReservationReference,
      supplierConfirmationReference: parsed.supplierConfirmationReference,
      providerCorrelationId: parsed.providerCorrelationId,
    });
  }
}
