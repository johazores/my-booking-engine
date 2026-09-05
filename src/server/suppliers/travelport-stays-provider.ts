import { createHash, randomUUID } from 'node:crypto';

import { normalizeCurrency, parseMoneyMajorToMinor, PricingValidationError } from '../pricing/money.ts';
import {
  HospitalitySupplierProviderError,
  type HospitalitySupplierCancellationPenalty,
  type HospitalitySupplierGuaranteeType,
  type HospitalitySupplierOffer,
  type HospitalitySupplierOfferRevalidationInput,
  type HospitalitySupplierOfferRevalidationResult,
  type HospitalitySupplierOfferSearchInput,
  type HospitalitySupplierOfferSearchResult,
  type HospitalitySupplierPaymentTiming,
  type HospitalitySupplierPriceChangeProbability,
  type HospitalitySupplierPricingProvider,
  type HospitalitySupplierProperty,
  type HospitalitySupplierSearchInput,
  type HospitalitySupplierSearchPageInput,
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
const MAX_PAGE_TOKEN_LENGTH = 4_096;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE_NUMBER = 5;
const MAX_PROVIDER_REFERENCE_LENGTH = 4_096;
const MAX_ROOM_TYPES = 128;
const MAX_RATES_PER_ROOM = 256;
const MAX_OFFERS = 512;
const MAX_CANCELLATION_PENALTIES = 16;
const tokenCache = new Map<string, Readonly<{ accessToken: string; expiresAtMs: number }>>();
const tokenRequests = new Map<string, Promise<string>>();

type TravelportPropertyIdentity = Readonly<{
  chainCode: string;
  propertyCode: string;
  authority: 'TVPT';
}>;

type TravelportRateIdentity = Readonly<{
  value: string;
  authority: 'TVPT' | 'BKNG';
}>;

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
}): Readonly<{ credentials: TravelportStaysCredentials; capabilities: readonly ['availability', 'hotel-search', 'pricing'] }> {
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
    capabilities: Object.freeze(['availability', 'hotel-search', 'pricing'] as const),
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

function normalizeStayInput(input: {
  checkInDateLocal: unknown;
  checkOutDateLocal: unknown;
  rooms: unknown;
  adults: unknown;
  childAges?: readonly number[];
}) {
  const checkInDateLocal = normalizeLocalDate(input.checkInDateLocal, 'Check-in date');
  const checkOutDateLocal = normalizeLocalDate(input.checkOutDateLocal, 'Check-out date');
  if (checkOutDateLocal <= checkInDateLocal) throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Check-out must be after check-in.');
  if (!Number.isInteger(input.rooms) || (input.rooms as number) < 1 || (input.rooms as number) > 4) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Room count is invalid.');
  }
  if (!Number.isInteger(input.adults) || (input.adults as number) < 1 || (input.adults as number) > 16) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Adult count is invalid.');
  }
  const childAges = input.childAges ? [...input.childAges] : [];
  if (childAges.length > 8 || childAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Child ages are invalid.');
  }
  return Object.freeze({
    checkInDateLocal,
    checkOutDateLocal,
    rooms: input.rooms as number,
    adults: input.adults as number,
    childAges: Object.freeze(childAges),
  });
}

function normalizeSearchInput(input: HospitalitySupplierSearchInput) {
  const cityIataCode = typeof input.cityIataCode === 'string' ? input.cityIataCode.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(cityIataCode)) throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'City IATA code is invalid.');
  const stay = normalizeStayInput(input);
  const radiusKm = input.radiusKm ?? 25;
  if (!Number.isInteger(radiusKm) || radiusKm < 1 || radiusKm > 100) throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Search radius is invalid.');
  return Object.freeze({ ...stay, cityIataCode, radiusKm });
}

function normalizeSearchPageInput(input: HospitalitySupplierSearchPageInput) {
  if (typeof input.pageToken !== 'string' || !input.pageToken || input.pageToken.length > MAX_PAGE_TOKEN_LENGTH || /[\r\n]/.test(input.pageToken)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Search page token is invalid.');
  }
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 2 || input.pageNumber > MAX_PAGE_NUMBER) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Search page number is invalid.');
  }
  return Object.freeze({ pageToken: input.pageToken, pageNumber: input.pageNumber });
}

function boundedProviderCode(value: unknown, label: string, max = 128): string {
  if (typeof value !== 'string') throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\r\n]/.test(normalized)) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE', `${label} is invalid.`);
  }
  return normalized;
}

function encodeReference(payload: Readonly<Record<string, string>>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeReference(value: unknown): unknown {
  if (typeof value !== 'string' || !value || value.length > MAX_PROVIDER_REFERENCE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier reference is invalid.');
  }
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier reference is invalid.');
  }
}

function propertyReference(identity: TravelportPropertyIdentity): string {
  return encodeReference(identity);
}

function decodePropertyReference(value: unknown): TravelportPropertyIdentity {
  const decoded = decodeReference(value);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier property reference is invalid.');
  }
  const payload = decoded as { chainCode?: unknown; propertyCode?: unknown; authority?: unknown };
  if (payload.authority !== 'TVPT') throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier property reference authority is unsupported.');
  const chainCode = typeof payload.chainCode === 'string' ? payload.chainCode.trim() : '';
  const propertyCode = typeof payload.propertyCode === 'string' ? payload.propertyCode.trim() : '';
  if (!/^[A-Za-z0-9]{1,16}$/.test(chainCode) || !/^[A-Za-z0-9]{1,32}$/.test(propertyCode)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier property reference is invalid.');
  }
  return Object.freeze({ chainCode, propertyCode, authority: 'TVPT' });
}

function offerReference(property: TravelportPropertyIdentity, rate: TravelportRateIdentity): string {
  return encodeReference({
    chainCode: property.chainCode,
    propertyCode: property.propertyCode,
    propertyAuthority: property.authority,
    rateValue: rate.value,
    rateAuthority: rate.authority,
  });
}

function decodeOfferReference(value: unknown): Readonly<{ property: TravelportPropertyIdentity; rate: TravelportRateIdentity }> {
  const decoded = decodeReference(value);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier offer reference is invalid.');
  }
  const payload = decoded as {
    chainCode?: unknown;
    propertyCode?: unknown;
    propertyAuthority?: unknown;
    rateValue?: unknown;
    rateAuthority?: unknown;
  };
  const property = decodePropertyReference(encodeReference({
    chainCode: typeof payload.chainCode === 'string' ? payload.chainCode : '',
    propertyCode: typeof payload.propertyCode === 'string' ? payload.propertyCode : '',
    authority: typeof payload.propertyAuthority === 'string' ? payload.propertyAuthority : '',
  }));
  if ((payload.rateAuthority !== 'TVPT' && payload.rateAuthority !== 'BKNG') || typeof payload.rateValue !== 'string') {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier offer reference is invalid.');
  }
  const valueNormalized = payload.rateValue.trim();
  if (!valueNormalized || valueNormalized.length > MAX_PROVIDER_REFERENCE_LENGTH || /[\r\n]/.test(valueNormalized)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier offer reference is invalid.');
  }
  return Object.freeze({ property, rate: Object.freeze({ value: valueNormalized, authority: payload.rateAuthority }) });
}

function normalizePropertyIdentity(value: unknown): TravelportPropertyIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const property = value as { chainCode?: unknown; propertyCode?: unknown };
  const chainCode = boundedProviderCode(property.chainCode, 'Travelport chain code', 16);
  const propertyCode = boundedProviderCode(property.propertyCode, 'Travelport property code', 32);
  if (!/^[A-Za-z0-9]+$/.test(chainCode) || !/^[A-Za-z0-9]+$/.test(propertyCode)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  return Object.freeze({ chainCode, propertyCode, authority: 'TVPT' });
}

function normalizeProperty(value: unknown): HospitalitySupplierProperty | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const property = value as { name?: unknown; chainCode?: unknown; propertyCode?: unknown; estimatedPropertyType?: unknown; availability?: unknown };
  if (typeof property.name !== 'string' || !property.name.trim() || property.name.length > 500) return null;
  let identity: TravelportPropertyIdentity;
  try {
    identity = normalizePropertyIdentity(property);
  } catch {
    return null;
  }
  const propertyType = typeof property.estimatedPropertyType === 'string' && property.estimatedPropertyType.trim()
    ? property.estimatedPropertyType.trim().slice(0, 120)
    : null;
  return Object.freeze({
    supplierPropertyReference: propertyReference(identity),
    name: property.name.trim(),
    propertyType,
    available: property.availability === true,
  });
}

function normalizeSearchResponse(value: unknown): HospitalitySupplierSearchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const payload = value as { pagination?: unknown; hotelsResponse?: unknown };
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
  if ((pageData.pageSize as number) > MAX_PAGE_SIZE || propertyItems.length > (pageData.pageSize as number)) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  if (pageData.paginationToken !== undefined && (
    typeof pageData.paginationToken !== 'string'
    || pageData.paginationToken.length > MAX_PAGE_TOKEN_LENGTH
    || /[\r\n]/.test(pageData.paginationToken)
  )) {
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

function normalizeOfferSearchInput(input: HospitalitySupplierOfferSearchInput) {
  const stay = normalizeStayInput(input);
  const property = decodePropertyReference(input.supplierPropertyReference);
  let currency: string;
  try {
    currency = normalizeCurrency(input.currency);
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Offer currency is invalid.');
  }
  return Object.freeze({ ...stay, property, currency, supplierPropertyReference: propertyReference(property) });
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > max || /[\r\n]/.test(normalized)) return normalized.slice(0, max);
  return normalized;
}

function normalizeProviderMoney(value: unknown, currency: string): bigint {
  const amount = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!amount) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  try {
    return parseMoneyMajorToMinor(amount, currency).amountMinor;
  } catch (error) {
    if (error instanceof PricingValidationError) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    throw error;
  }
}

function normalizeRateIdentity(value: unknown): TravelportRateIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const key = value as { value?: unknown; authority?: unknown };
  if ((key.authority !== 'TVPT' && key.authority !== 'BKNG') || typeof key.value !== 'string') {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  const normalized = key.value.trim();
  if (!normalized || normalized.length > MAX_PROVIDER_REFERENCE_LENGTH || /[\r\n]/.test(normalized)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  return Object.freeze({ value: normalized, authority: key.authority });
}

function normalizePaymentTiming(value: unknown): HospitalitySupplierPaymentTiming {
  if (value === 'PrePay') return 'PREPAY';
  if (value === 'PostPay') return 'POSTPAY';
  return 'UNKNOWN';
}

function normalizeGuaranteeType(value: unknown): HospitalitySupplierGuaranteeType {
  if (value === 'GuaranteeRequired') return 'GUARANTEE_REQUIRED';
  if (value === 'NoGuaranteesAccepted') return 'NO_GUARANTEES_ACCEPTED';
  if (value === 'DepositRequired') return 'DEPOSIT_REQUIRED';
  if (value === 'PrepayRequired') return 'PREPAY_REQUIRED';
  return 'UNKNOWN';
}

function normalizePriceChangeProbability(value: unknown): HospitalitySupplierPriceChangeProbability {
  if (value === 'High') return 'HIGH';
  if (value === 'Medium') return 'MEDIUM';
  if (value === 'Low') return 'LOW';
  return 'UNKNOWN';
}

function normalizePenalty(value: unknown): HospitalitySupplierCancellationPenalty {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const penalty = value as {
    deadlineLocal?: unknown;
    estimatedDeadlineLocal?: unknown;
    cancelShortDescription?: unknown;
    penalty?: unknown;
  };
  let money: HospitalitySupplierCancellationPenalty['money'] = null;
  let moneyEstimated: boolean | null = null;
  if (penalty.penalty !== undefined) {
    if (!penalty.penalty || typeof penalty.penalty !== 'object' || Array.isArray(penalty.penalty)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    const providerPenalty = penalty.penalty as { estimatedAmount?: unknown; currencyAmount?: unknown };
    moneyEstimated = optionalBoolean(providerPenalty.estimatedAmount);
    if (providerPenalty.currencyAmount !== undefined) {
      if (!providerPenalty.currencyAmount || typeof providerPenalty.currencyAmount !== 'object' || Array.isArray(providerPenalty.currencyAmount)) {
        throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      }
      const currencyAmount = providerPenalty.currencyAmount as { currency?: unknown; amount?: unknown };
      if (typeof currencyAmount.currency !== 'string') throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      let currency: string;
      try {
        currency = normalizeCurrency(currencyAmount.currency);
      } catch {
        throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      }
      money = Object.freeze({ currency, amountMinor: normalizeProviderMoney(currencyAmount.amount, currency) });
    }
  }
  const deadlineLocal = boundedText(penalty.deadlineLocal, 100);
  return Object.freeze({
    deadlineLocal,
    deadlineEstimated: optionalBoolean(penalty.estimatedDeadlineLocal),
    description: boundedText(penalty.cancelShortDescription, 512),
    money,
    moneyEstimated,
  });
}

function fingerprintOffer(value: Omit<HospitalitySupplierOffer, 'offerFingerprint'>): string {
  const payload = {
    supplierPropertyReference: value.supplierPropertyReference,
    supplierOfferReference: value.supplierOfferReference,
    roomDescription: value.roomDescription,
    rateDescription: value.rateDescription,
    availableQuantity: value.availableQuantity,
    price: {
      currency: value.price.currency,
      baseMinor: value.price.baseMinor.toString(),
      taxMinor: value.price.taxMinor.toString(),
      totalMinor: value.price.totalMinor.toString(),
      includedFeeMinor: value.price.includedFeeMinor?.toString() ?? null,
      feesDueAtPropertyMinor: value.price.feesDueAtPropertyMinor?.toString() ?? null,
      taxesIncludedInBase: value.price.taxesIncludedInBase,
      resortFeeIncluded: value.price.resortFeeIncluded,
      predictedPriceChangeDuringStay: value.price.predictedPriceChangeDuringStay,
    },
    terms: {
      ...value.terms,
      cancellationPenalties: value.terms.cancellationPenalties.map((penalty) => ({
        ...penalty,
        money: penalty.money ? { currency: penalty.money.currency, amountMinor: penalty.money.amountMinor.toString() } : null,
      })),
    },
    inclusions: value.inclusions,
    priceChangeProbability: value.priceChangeProbability,
    revalidationRequired: value.revalidationRequired,
    rulesRequiredBeforeReservation: value.rulesRequiredBeforeReservation,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function normalizeOffer(input: {
  rate: unknown;
  roomDescription: unknown;
  property: TravelportPropertyIdentity;
  supplierPropertyReference: string;
  requestedCurrency: string;
}): HospitalitySupplierOffer {
  if (!input.rate || typeof input.rate !== 'object' || Array.isArray(input.rate)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const rate = input.rate as {
    rateKey?: unknown;
    rateDescription?: unknown;
    roomDescription?: unknown;
    quantity?: unknown;
    wifiIncluded?: unknown;
    breakfastIncluded?: unknown;
    lunchIncluded?: unknown;
    dinnerIncluded?: unknown;
    freeParkingIncluded?: unknown;
    valetParkingIncluded?: unknown;
    priceChangeProbability?: unknown;
    price?: unknown;
    terms?: unknown;
  };
  const rateIdentity = normalizeRateIdentity(rate.rateKey);
  if (!Number.isInteger(rate.quantity) || (rate.quantity as number) < 1 || (rate.quantity as number) > 999) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  if (!rate.price || typeof rate.price !== 'object' || Array.isArray(rate.price)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const price = rate.price as {
    currencyCode?: unknown;
    base?: unknown;
    totalTaxes?: unknown;
    totalPrice?: unknown;
    totalIncludedFees?: unknown;
    totalFeesDueAtProperty?: unknown;
    taxesIncludedInBase?: unknown;
    resortFeeIncluded?: unknown;
    predictedPriceChangeDuringStay?: unknown;
  };
  if (typeof price.currencyCode !== 'string') throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  let currency: string;
  try {
    currency = normalizeCurrency(price.currencyCode);
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  if (currency !== input.requestedCurrency) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');

  const readAmount = (component: unknown, required: boolean): bigint | null => {
    if (component === undefined || component === null) {
      if (required) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      return null;
    }
    if (!component || typeof component !== 'object' || Array.isArray(component)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    return normalizeProviderMoney((component as { amount?: unknown }).amount, currency);
  };
  const baseMinor = readAmount(price.base, true) as bigint;
  const taxMinor = readAmount(price.totalTaxes, true) as bigint;
  const totalMinor = readAmount(price.totalPrice, true) as bigint;
  if (totalMinor <= 0n) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');

  let termsValue: HospitalitySupplierOffer['terms'];
  if (rate.terms === undefined || rate.terms === null) {
    termsValue = Object.freeze({
      refundable: null,
      paymentTiming: 'UNKNOWN',
      guaranteeType: 'UNKNOWN',
      paymentTypeEstimated: null,
      customerLoyaltyRequiredAtReservation: null,
      qualificationRequiredAtCheckIn: null,
      cancellationNote: null,
      cancellationPenalties: Object.freeze([]),
    });
  } else {
    if (typeof rate.terms !== 'object' || Array.isArray(rate.terms)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    const terms = rate.terms as {
      refundable?: unknown;
      ratePaymentInfo?: unknown;
      guaranteeType?: unknown;
      paymentTypeEstimated?: unknown;
      customerLoyaltyIDRequiredAtReservation?: unknown;
      rateQualificationIDRequiredAtCheckIn?: unknown;
      cancelNote?: unknown;
      cancelPenalties?: unknown;
    };
    if (terms.cancelPenalties !== undefined && !Array.isArray(terms.cancelPenalties)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    const penalties = Array.isArray(terms.cancelPenalties) ? terms.cancelPenalties : [];
    if (penalties.length > MAX_CANCELLATION_PENALTIES) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    termsValue = Object.freeze({
      refundable: optionalBoolean(terms.refundable),
      paymentTiming: normalizePaymentTiming(terms.ratePaymentInfo),
      guaranteeType: normalizeGuaranteeType(terms.guaranteeType),
      paymentTypeEstimated: optionalBoolean(terms.paymentTypeEstimated),
      customerLoyaltyRequiredAtReservation: optionalBoolean(terms.customerLoyaltyIDRequiredAtReservation),
      qualificationRequiredAtCheckIn: optionalBoolean(terms.rateQualificationIDRequiredAtCheckIn),
      cancellationNote: boundedText(terms.cancelNote, 512),
      cancellationPenalties: Object.freeze(penalties.map(normalizePenalty)),
    });
  }

  const normalizedOffer: Omit<HospitalitySupplierOffer, 'offerFingerprint'> = Object.freeze({
    supplierPropertyReference: input.supplierPropertyReference,
    supplierOfferReference: offerReference(input.property, rateIdentity),
    roomDescription: boundedText(rate.roomDescription, 500) ?? boundedText(input.roomDescription, 500),
    rateDescription: boundedText(rate.rateDescription, 500),
    availableQuantity: rate.quantity as number,
    price: Object.freeze({
      currency,
      baseMinor,
      taxMinor,
      totalMinor,
      includedFeeMinor: readAmount(price.totalIncludedFees, false),
      feesDueAtPropertyMinor: readAmount(price.totalFeesDueAtProperty, false),
      taxesIncludedInBase: optionalBoolean(price.taxesIncludedInBase),
      resortFeeIncluded: optionalBoolean(price.resortFeeIncluded),
      predictedPriceChangeDuringStay: optionalBoolean(price.predictedPriceChangeDuringStay),
    }),
    terms: termsValue,
    inclusions: Object.freeze({
      wifi: optionalBoolean(rate.wifiIncluded),
      breakfast: optionalBoolean(rate.breakfastIncluded),
      lunch: optionalBoolean(rate.lunchIncluded),
      dinner: optionalBoolean(rate.dinnerIncluded),
      freeParking: optionalBoolean(rate.freeParkingIncluded),
      valetParking: optionalBoolean(rate.valetParkingIncluded),
    }),
    priceChangeProbability: normalizePriceChangeProbability(rate.priceChangeProbability),
    revalidationRequired: true,
    rulesRequiredBeforeReservation: true,
  });
  return Object.freeze({ ...normalizedOffer, offerFingerprint: fingerprintOffer(normalizedOffer) });
}

function normalizeOfferSearchResponse(input: {
  value: unknown;
  expectedProperty: TravelportPropertyIdentity;
  requestedCurrency: string;
  observedAt: string;
}): HospitalitySupplierOfferSearchResult {
  if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const payload = input.value as { pagination?: unknown; hotelsResponse?: unknown };
  if (!payload.pagination || typeof payload.pagination !== 'object' || Array.isArray(payload.pagination)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const pagination = payload.pagination as { page?: unknown; pageSize?: unknown; totalPages?: unknown; totalItems?: unknown };
  if (![pagination.page, pagination.pageSize, pagination.totalPages, pagination.totalItems].every((value) => Number.isInteger(value) && (value as number) >= 0)) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  if (
    (pagination.page as number) !== 1
    || (pagination.pageSize as number) > MAX_PAGE_SIZE
    || (pagination.totalPages as number) > 1
    || (pagination.totalItems as number) > 1
  ) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  if (!payload.hotelsResponse || typeof payload.hotelsResponse !== 'object' || Array.isArray(payload.hotelsResponse)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const propertyItems = (payload.hotelsResponse as { propertyItems?: unknown }).propertyItems;
  if (
    !Array.isArray(propertyItems)
    || propertyItems.length > 1
    || propertyItems.length > (pagination.pageSize as number)
    || propertyItems.length !== (pagination.totalItems as number)
  ) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  const supplierPropertyReference = propertyReference(input.expectedProperty);
  if (propertyItems.length === 0) {
    return Object.freeze({
      supplierPropertyReference,
      property: null,
      offers: Object.freeze([]),
      observedAt: input.observedAt,
      providerCacheMode: 'NO_CACHE',
      validUntil: null,
      revalidationRequired: true,
      rulesRequiredBeforeReservation: true,
    });
  }

  const propertyItem = propertyItems[0];
  if (!propertyItem || typeof propertyItem !== 'object' || Array.isArray(propertyItem)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const identity = normalizePropertyIdentity(propertyItem);
  if (identity.chainCode !== input.expectedProperty.chainCode || identity.propertyCode !== input.expectedProperty.propertyCode) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  const normalizedProperty = normalizeProperty(propertyItem);
  if (!normalizedProperty) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const roomTypes = (propertyItem as { roomTypes?: unknown }).roomTypes;
  if (!Array.isArray(roomTypes) || roomTypes.length > MAX_ROOM_TYPES) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');

  const offers: HospitalitySupplierOffer[] = [];
  const offerReferences = new Set<string>();
  for (const room of roomTypes) {
    if (!room || typeof room !== 'object' || Array.isArray(room)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    const roomObject = room as { shortRoomDescription?: unknown; rates?: unknown };
    if (!Array.isArray(roomObject.rates) || roomObject.rates.length > MAX_RATES_PER_ROOM) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    for (const rate of roomObject.rates) {
      const offer = normalizeOffer({
        rate,
        roomDescription: roomObject.shortRoomDescription,
        property: identity,
        supplierPropertyReference,
        requestedCurrency: input.requestedCurrency,
      });
      if (offerReferences.has(offer.supplierOfferReference)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      offerReferences.add(offer.supplierOfferReference);
      offers.push(offer);
      if (offers.length > MAX_OFFERS) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    }
  }

  return Object.freeze({
    supplierPropertyReference,
    property: normalizedProperty,
    offers: Object.freeze(offers),
    observedAt: input.observedAt,
    providerCacheMode: 'NO_CACHE',
    validUntil: null,
    revalidationRequired: true,
    rulesRequiredBeforeReservation: true,
  });
}

export class TravelportStaysProvider implements HospitalitySupplierPricingProvider {
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
      throw new TravelportStaysConfigurationError('Travelport token cache key is invalid.');
    }
    this.#credentials = input.credentials;
    this.#cacheKey = input.cacheKey;
    this.#fetchImpl = input.fetchImpl ?? fetch;
    this.#timeoutMs = normalizeTimeout(input.timeoutMs);
    this.#now = input.now ?? (() => new Date());
  }

  async #accessToken(): Promise<string> {
    return loadCachedAccessToken({
      cacheKey: this.#cacheKey,
      credentials: this.#credentials,
      fetchImpl: this.#fetchImpl,
      timeoutMs: this.#timeoutMs,
      nowMs: this.#now().getTime(),
    });
  }

  #requestHeaders(accessToken: string, freshPricing: boolean) {
    return {
      'Accept-Encoding': 'gzip, deflate',
      'Cache-Control': 'no-cache',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      XAUTH_TRAVELPORT_ACCESSGROUP: this.#credentials.accessGroup,
      E2ETrackingID: `sf-${randomUUID()}`,
      username: this.#credentials.username,
      password: this.#credentials.password,
      client_id: this.#credentials.clientId,
      client_secret: this.#credentials.clientSecret,
      ...(freshPricing ? { 'TVP-Cache-Control': 'no-cache' } : {}),
    };
  }

  async #hotelRequest<T>(input: {
    url: string;
    init: Pick<RequestInit, 'method' | 'body'>;
    freshPricing?: boolean;
    normalize: (value: unknown) => T;
  }): Promise<T> {
    const response = await fetchWithTimeout({
      fetchImpl: this.#fetchImpl,
      url: input.url,
      timeoutMs: this.#timeoutMs,
      init: {
        ...input.init,
        headers: this.#requestHeaders(await this.#accessToken(), input.freshPricing === true),
        cache: 'no-store',
      },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) tokenCache.delete(this.#cacheKey);
      throw providerFailureForStatus(response.status);
    }
    const payload = await response.json().catch(() => null);
    return input.normalize(payload);
  }

  async searchProperties(input: HospitalitySupplierSearchInput): Promise<HospitalitySupplierSearchResult> {
    const search = normalizeSearchInput(input);
    const endpoints = ENDPOINTS[this.#credentials.environment];
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

    return this.#hotelRequest({
      url: `${endpoints.staysV12}search/searchcomplete`,
      init: { method: 'POST', body: JSON.stringify(body) },
      normalize: normalizeSearchResponse,
    });
  }

  async searchPropertiesPage(input: HospitalitySupplierSearchPageInput): Promise<HospitalitySupplierSearchResult> {
    const page = normalizeSearchPageInput(input);
    const endpoints = ENDPOINTS[this.#credentials.environment];
    const result = await this.#hotelRequest({
      url: `${endpoints.staysV12}search/searchcomplete/${encodeURIComponent(page.pageToken)}?pageNumber=${page.pageNumber}`,
      init: { method: 'GET' },
      normalize: normalizeSearchResponse,
    });
    if (result.page !== page.pageNumber) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    return result;
  }

  async searchPropertyOffers(input: HospitalitySupplierOfferSearchInput): Promise<HospitalitySupplierOfferSearchResult> {
    const search = normalizeOfferSearchInput(input);
    const endpoints = ENDPOINTS[this.#credentials.environment];
    const children = search.childAges.map((age) => ({ age }));
    const body = {
      requestedCurrency: search.currency,
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
        propertyKeys: [{
          chainCode: search.property.chainCode,
          propertyCode: search.property.propertyCode,
          authority: search.property.authority,
        }],
        returnOnlyAvailableProperties: true,
      },
      returnCompleteNightlyRateBreakdown: true,
    };
    const observedAt = this.#now().toISOString();
    return this.#hotelRequest({
      url: `${endpoints.staysV12}search/searchcomplete`,
      init: { method: 'POST', body: JSON.stringify(body) },
      freshPricing: true,
      normalize: (value) => normalizeOfferSearchResponse({
        value,
        expectedProperty: search.property,
        requestedCurrency: search.currency,
        observedAt,
      }),
    });
  }

  async revalidatePropertyOffer(input: HospitalitySupplierOfferRevalidationInput): Promise<HospitalitySupplierOfferRevalidationResult> {
    if (typeof input.expectedTotalMinor !== 'bigint' || input.expectedTotalMinor < 0n) {
      throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Expected offer total is invalid.');
    }
    if (typeof input.expectedOfferFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(input.expectedOfferFingerprint)) {
      throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Expected offer fingerprint is invalid.');
    }
    const offerIdentity = decodeOfferReference(input.supplierOfferReference);
    const property = decodePropertyReference(input.supplierPropertyReference);
    if (
      offerIdentity.property.chainCode !== property.chainCode
      || offerIdentity.property.propertyCode !== property.propertyCode
      || offerIdentity.property.authority !== property.authority
    ) {
      throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier offer does not belong to the selected property.');
    }
    const fresh = await this.searchPropertyOffers(input);
    const offer = fresh.offers.find((candidate) => candidate.supplierOfferReference === input.supplierOfferReference) ?? null;
    if (!offer) return Object.freeze({ status: 'UNAVAILABLE', offer: null, observedAt: fresh.observedAt, validUntil: null });
    const status = offer.price.totalMinor !== input.expectedTotalMinor
      ? 'PRICE_CHANGED'
      : offer.offerFingerprint !== input.expectedOfferFingerprint
        ? 'OFFER_CHANGED'
        : 'UNCHANGED';
    return Object.freeze({
      status,
      offer,
      observedAt: fresh.observedAt,
      validUntil: null,
    });
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
