import { randomUUID } from 'node:crypto';

import {
  HospitalitySupplierProviderError,
  type HospitalitySupplierProperty,
  type HospitalitySupplierProvider,
  type HospitalitySupplierSearchInput,
  type HospitalitySupplierSearchResult,
} from './hospitality-supplier-provider.ts';

export const travelportStaysEnvironments = ['pre-production', 'production'] as const;
export type TravelportStaysEnvironment = (typeof travelportStaysEnvironments)[number];

export type TravelportStaysCredentials = Readonly<{
  environment: TravelportStaysEnvironment;
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  accessGroup: string;
}>;

export class TravelportStaysConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TravelportStaysConfigurationError';
  }
}

const ENDPOINTS = Object.freeze({
  'pre-production': Object.freeze({
    authentication: 'https://auth.pp.travelport.net/oauth/token',
    staysV12: 'https://api.pp.travelport.net/12/hotel/',
  }),
  production: Object.freeze({
    authentication: 'https://auth.travelport.net/oauth/token',
    staysV12: 'https://api.travelport.net/12/hotel/',
  }),
});

const DEFAULT_TIMEOUT_MS = 15_000;
const DOCUMENTED_TOKEN_SECONDS = 86_400;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const MAX_TOKEN_LENGTH = 16_384;
const MAX_PAGE_SIZE = 100;
const tokenCache = new Map<string, Readonly<{ accessToken: string; expiresAtMs: number }>>();
const tokenRequests = new Map<string, Promise<string>>();

function boundedCredential(value: unknown, label: string, max = 4096): string {
  if (typeof value !== 'string') throw new TravelportStaysConfigurationError(`${label} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\r\n]/.test(normalized)) {
    throw new TravelportStaysConfigurationError(`${label} is invalid.`);
  }
  return normalized;
}

export function normalizeTravelportStaysConfiguration(input: {
  environment: unknown;
  username: unknown;
  password: unknown;
  clientId: unknown;
  clientSecret: unknown;
  accessGroup: unknown;
}): Readonly<{ credentials: TravelportStaysCredentials; capabilities: readonly ['hotel-search'] }> {
  if (typeof input.environment !== 'string' || !travelportStaysEnvironments.includes(input.environment as TravelportStaysEnvironment)) {
    throw new TravelportStaysConfigurationError('Travelport environment is invalid.');
  }

  return Object.freeze({
    credentials: Object.freeze({
      environment: input.environment as TravelportStaysEnvironment,
      username: boundedCredential(input.username, 'Travelport username', 512),
      password: boundedCredential(input.password, 'Travelport password'),
      clientId: boundedCredential(input.clientId, 'Travelport client ID', 512),
      clientSecret: boundedCredential(input.clientSecret, 'Travelport client secret'),
      accessGroup: boundedCredential(input.accessGroup, 'Travelport access group', 512),
    }),
    capabilities: Object.freeze(['hotel-search'] as const),
  });
}

export function readTravelportStaysCredentials(credentials: Readonly<Record<string, string>>): TravelportStaysCredentials {
  return normalizeTravelportStaysConfiguration({
    environment: credentials.environment,
    username: credentials.username,
    password: credentials.password,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    accessGroup: credentials.accessGroup,
  }).credentials;
}

function normalizeTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new TravelportStaysConfigurationError('Travelport timeout must be between 1000 and 120000 milliseconds.');
  }
  return timeoutMs;
}

function providerFailureForStatus(status: number): HospitalitySupplierProviderError {
  if (status === 401 || status === 403) return new HospitalitySupplierProviderError('AUTHENTICATION_FAILED');
  if (status === 429) return new HospitalitySupplierProviderError('RATE_LIMITED');
  if (status >= 500) return new HospitalitySupplierProviderError('PROVIDER_UNAVAILABLE');
  return new HospitalitySupplierProviderError('INVALID_RESPONSE');
}

async function fetchWithTimeout(input: {
  fetchImpl: typeof fetch;
  url: string;
  init: RequestInit;
  timeoutMs: number;
}): Promise<Response> {
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

function parseTokenPayload(value: unknown, nowMs: number): Readonly<{ accessToken: string; expiresAtMs: number }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const payload = value as { access_token?: unknown; expires_in?: unknown };
  if (typeof payload.access_token !== 'string' || !payload.access_token || payload.access_token.length > MAX_TOKEN_LENGTH || /[\r\n]/.test(payload.access_token)) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }

  let lifetimeSeconds = DOCUMENTED_TOKEN_SECONDS;
  if (payload.expires_in !== undefined) {
    const numericExpiry = typeof payload.expires_in === 'string' ? Number(payload.expires_in) : payload.expires_in;
    if (typeof numericExpiry !== 'number' || !Number.isFinite(numericExpiry) || numericExpiry <= 0) {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    }
    lifetimeSeconds = Math.min(DOCUMENTED_TOKEN_SECONDS, Math.floor(numericExpiry));
  }

  const lifetimeMs = lifetimeSeconds * 1000;
  return Object.freeze({
    accessToken: payload.access_token,
    expiresAtMs: nowMs + Math.max(1_000, lifetimeMs - TOKEN_REFRESH_SKEW_MS),
  });
}

export async function requestTravelportStaysAccessToken(input: {
  credentials: TravelportStaysCredentials;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  nowMs?: number;
}): Promise<Readonly<{ accessToken: string; expiresAtMs: number }>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = normalizeTimeout(input.timeoutMs);
  const endpoints = ENDPOINTS[input.credentials.environment];
  const body = new URLSearchParams({
    grant_type: 'password',
    username: input.credentials.username,
    password: input.credentials.password,
    client_id: input.credentials.clientId,
    client_secret: input.credentials.clientSecret,
  });

  const response = await fetchWithTimeout({
    fetchImpl,
    url: endpoints.authentication,
    timeoutMs,
    init: {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      cache: 'no-store',
    },
  });
  if (!response.ok) throw providerFailureForStatus(response.status);

  const payload = await response.json().catch(() => null);
  return parseTokenPayload(payload, input.nowMs ?? Date.now());
}

async function loadCachedAccessToken(input: {
  cacheKey: string;
  credentials: TravelportStaysCredentials;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  nowMs: number;
}): Promise<string> {
  const cached = tokenCache.get(input.cacheKey);
  if (cached && cached.expiresAtMs > input.nowMs) return cached.accessToken;

  const pending = tokenRequests.get(input.cacheKey);
  if (pending) return pending;

  const request = requestTravelportStaysAccessToken({
    credentials: input.credentials,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    nowMs: input.nowMs,
  }).then((token) => {
    tokenCache.set(input.cacheKey, token);
    return token.accessToken;
  }).finally(() => {
    tokenRequests.delete(input.cacheKey);
  });

  tokenRequests.set(input.cacheKey, request);
  return request;
}

function normalizeLocalDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', `${label} is invalid.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', `${label} is invalid.`);
  }
  return value;
}

function normalizeSearchInput(input: HospitalitySupplierSearchInput) {
  const cityIataCode = typeof input.cityIataCode === 'string' ? input.cityIataCode.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(cityIataCode)) throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'City IATA code is invalid.');
  const checkInDateLocal = normalizeLocalDate(input.checkInDateLocal, 'Check-in date');
  const checkOutDateLocal = normalizeLocalDate(input.checkOutDateLocal, 'Check-out date');
  if (checkOutDateLocal <= checkInDateLocal) throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Check-out must be after check-in.');
  if (!Number.isInteger(input.rooms) || input.rooms < 1 || input.rooms > 4) throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Room count is invalid.');
  if (!Number.isInteger(input.adults) || input.adults < 1 || input.adults > 16) throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Adult count is invalid.');

  const childAges = input.childAges ? [...input.childAges] : [];
  if (childAges.length > 8 || childAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Child ages are invalid.');
  }
  const radiusKm = input.radiusKm ?? 25;
  if (!Number.isInteger(radiusKm) || radiusKm < 1 || radiusKm > 100) throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Search radius is invalid.');

  return Object.freeze({ cityIataCode, checkInDateLocal, checkOutDateLocal, rooms: input.rooms, adults: input.adults, childAges, radiusKm });
}

function propertyReference(propertyCode: string): string {
  return Buffer.from(JSON.stringify({ propertyCode }), 'utf8').toString('base64url');
}

function normalizeProperty(value: unknown): HospitalitySupplierProperty | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const property = value as { name?: unknown; propertyCode?: unknown; estimatedPropertyType?: unknown; availability?: unknown };
  if (typeof property.name !== 'string' || !property.name.trim() || property.name.length > 500) return null;
  if (typeof property.propertyCode !== 'string' || !property.propertyCode.trim() || property.propertyCode.length > 128) return null;
  const propertyType = typeof property.estimatedPropertyType === 'string' && property.estimatedPropertyType.trim()
    ? property.estimatedPropertyType.trim().slice(0, 120)
    : null;
  return Object.freeze({
    supplierPropertyReference: propertyReference(property.propertyCode.trim()),
    name: property.name.trim(),
    propertyType,
    available: property.availability === true,
  });
}

function normalizeSearchResponse(value: unknown): HospitalitySupplierSearchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const payload = value as {
    pagination?: unknown;
    hotelsResponse?: unknown;
  };
  const pagination = payload.pagination;
  const hotelsResponse = payload.hotelsResponse;
  if (!pagination || typeof pagination !== 'object' || Array.isArray(pagination)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  if (!hotelsResponse || typeof hotelsResponse !== 'object' || Array.isArray(hotelsResponse)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');

  const pageData = pagination as { page?: unknown; pageSize?: unknown; totalPages?: unknown; totalItems?: unknown; paginationToken?: unknown };
  const propertyItems = (hotelsResponse as { propertyItems?: unknown }).propertyItems;
  if (!Array.isArray(propertyItems) || propertyItems.length > MAX_PAGE_SIZE) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');

  for (const key of ['page', 'pageSize', 'totalPages', 'totalItems'] as const) {
    if (!Number.isInteger(pageData[key]) || (pageData[key] as number) < 0) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  if ((pageData.pageSize as number) > MAX_PAGE_SIZE) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  if (pageData.paginationToken !== undefined && (typeof pageData.paginationToken !== 'string' || pageData.paginationToken.length > 4096)) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }

  const properties = propertyItems.map(normalizeProperty).filter((entry): entry is HospitalitySupplierProperty => entry !== null);
  if (properties.length !== propertyItems.length) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  return Object.freeze({
    properties: Object.freeze(properties),
    page: pageData.page as number,
    pageSize: pageData.pageSize as number,
    totalPages: pageData.totalPages as number,
    totalItems: pageData.totalItems as number,
    nextPageToken: typeof pageData.paginationToken === 'string' && pageData.paginationToken ? pageData.paginationToken : null,
  });
}

export class TravelportStaysProvider implements HospitalitySupplierProvider {
  readonly code = 'travelport-stays';
  readonly #credentials: TravelportStaysCredentials;
  readonly #cacheKey: string;
  readonly #fetchImpl: typeof fetch;
  readonly #timeoutMs: number;

  constructor(input: {
    credentials: TravelportStaysCredentials;
    cacheKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    if (!input.cacheKey || input.cacheKey.length > 512 || /[\r\n]/.test(input.cacheKey)) {
      throw new TravelportStaysConfigurationError('Travelport token cache key is invalid.');
    }
    this.#credentials = input.credentials;
    this.#cacheKey = input.cacheKey;
    this.#fetchImpl = input.fetchImpl ?? fetch;
    this.#timeoutMs = normalizeTimeout(input.timeoutMs);
  }

  async searchProperties(input: HospitalitySupplierSearchInput): Promise<HospitalitySupplierSearchResult> {
    const search = normalizeSearchInput(input);
    const accessToken = await loadCachedAccessToken({
      cacheKey: this.#cacheKey,
      credentials: this.#credentials,
      fetchImpl: this.#fetchImpl,
      timeoutMs: this.#timeoutMs,
      nowMs: Date.now(),
    });
    const endpoints = ENDPOINTS[this.#credentials.environment];
    const traceId = `sf-${randomUUID()}`;
    const children = search.childAges.map((age) => ({ age }));
    const body = {
      stayDetails: {
        checkInDateLocal: search.checkInDateLocal,
        checkOutDateLocal: search.checkOutDateLocal,
        rooms: search.rooms,
        guests: {
          adults: search.adults,
          ...(children.length > 0 ? { children } : {}),
        },
      },
      propertyFilter: {
        location: {
          type: 'cityIATACode',
          details: { iataCode: search.cityIataCode },
          radius: { value: search.radiusKm, unit: 'km' },
        },
        returnOnlyAvailableProperties: true,
      },
    };

    const response = await fetchWithTimeout({
      fetchImpl: this.#fetchImpl,
      url: `${endpoints.staysV12}search/searchcomplete`,
      timeoutMs: this.#timeoutMs,
      init: {
        method: 'POST',
        headers: {
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache',
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          XAUTH_TRAVELPORT_ACCESSGROUP: this.#credentials.accessGroup,
          E2ETrackingID: traceId,
          username: this.#credentials.username,
          password: this.#credentials.password,
          client_id: this.#credentials.clientId,
          client_secret: this.#credentials.clientSecret,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) tokenCache.delete(this.#cacheKey);
      throw providerFailureForStatus(response.status);
    }
    const payload = await response.json().catch(() => null);
    return normalizeSearchResponse(payload);
  }
}

export async function probeTravelportStaysIntegrationHealth(input: {
  credentials: TravelportStaysCredentials;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<Readonly<{
  status: 'HEALTHY' | 'AUTHENTICATION_FAILED' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'INVALID_RESPONSE';
  failureCode: 'AUTHENTICATION_FAILED' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'TIMEOUT' | 'INVALID_RESPONSE' | null;
}>> {
  try {
    await requestTravelportStaysAccessToken(input);
    return Object.freeze({ status: 'HEALTHY', failureCode: null });
  } catch (error) {
    if (!(error instanceof HospitalitySupplierProviderError)) throw error;
    if (error.code === 'AUTHENTICATION_FAILED') return Object.freeze({ status: 'AUTHENTICATION_FAILED', failureCode: error.code });
    if (error.code === 'RATE_LIMITED') return Object.freeze({ status: 'RATE_LIMITED', failureCode: error.code });
    if (error.code === 'TIMEOUT') return Object.freeze({ status: 'PROVIDER_UNAVAILABLE', failureCode: error.code });
    if (error.code === 'PROVIDER_UNAVAILABLE') return Object.freeze({ status: 'PROVIDER_UNAVAILABLE', failureCode: error.code });
    return Object.freeze({ status: 'INVALID_RESPONSE', failureCode: 'INVALID_RESPONSE' });
  }
}
