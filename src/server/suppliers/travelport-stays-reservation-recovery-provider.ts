import { randomUUID } from 'node:crypto';

import { HospitalitySupplierProviderError, type HospitalitySupplierFailureCode } from './hospitality-supplier-provider.ts';
import type {
  HospitalitySupplierReservationRecoveryProvider,
  HospitalitySupplierReservationRecoveryResult,
} from './hospitality-supplier-reservation-recovery-provider.ts';
import { parseTravelportStaysReservationResponse } from './travelport-stays-reservation-response.ts';
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
    return await input.fetchImpl(input.url, { ...input.init, signal: controller.signal });
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

  #headers(accessToken: string) {
    return {
      'Accept-Encoding': 'gzip, deflate',
      'Cache-Control': 'no-cache',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      XAUTH_TRAVELPORT_ACCESSGROUP: this.#credentials.accessGroup,
      E2ETrackingID: `sf-${randomUUID()}`,
      username: this.#credentials.username,
      password: this.#credentials.password,
      client_id: this.#credentials.clientId,
      client_secret: this.#credentials.clientSecret,
    } as const;
  }

  async retrieveReservation(providerReservationReference: string): Promise<HospitalitySupplierReservationRecoveryResult> {
    const reference = boundedSingleLine(providerReservationReference, 'Provider reservation reference', MAX_REFERENCE_LENGTH);
    const response = await fetchWithTimeout({
      fetchImpl: this.#fetchImpl,
      url: `${ENDPOINTS[this.#credentials.environment]}book/reservations/${encodeURIComponent(reference)}`,
      timeoutMs: this.#timeoutMs,
      init: {
        method: 'GET',
        cache: 'no-store',
        headers: this.#headers(await this.#accessToken()),
      },
    });
    if (response.status === 404) {
      return Object.freeze({ status: 'NOT_FOUND', providerReservationReference: reference, providerCorrelationId: null });
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) tokenCache.delete(this.#cacheKey);
      throw new HospitalitySupplierProviderError(failureCodeForStatus(response.status));
    }

    const payload = await response.json().catch(() => null);
    const parsed = parseTravelportStaysReservationResponse(payload, {
      expectedProviderReservationReference: reference,
    });
    return Object.freeze({
      status: 'FOUND',
      providerReservationReference: parsed.providerReservationReference,
      supplierConfirmationReference: parsed.supplierConfirmationReference,
      providerCorrelationId: parsed.providerCorrelationId,
    });
  }
}
