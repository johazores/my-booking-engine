import {
  HospitalitySupplierProviderError,
  type HospitalitySupplierOfferRevalidationInput,
  type HospitalitySupplierOfferRevalidationResult,
  type HospitalitySupplierOfferSearchInput,
  type HospitalitySupplierOfferSearchResult,
  type HospitalitySupplierSearchPageInput,
  type HospitalitySupplierSearchResult,
} from './hospitality-supplier-provider.ts';
import {
  assertTravelportStaysRulesCommercialAuthorityResponse,
  assertTravelportStaysSearchCommercialAuthorityResponse,
} from './travelport-stays-commercial-authority.ts';
import {
  normalizeTravelportStaysConfiguration as normalizeTravelportStaysConfigurationCore,
  probeTravelportStaysIntegrationHealth as probeTravelportStaysIntegrationHealthCore,
  requestTravelportStaysAccessToken as requestTravelportStaysAccessTokenCore,
  travelportStaysEnvironments,
  TravelportStaysConfigurationError,
  TravelportStaysProvider as CoreTravelportStaysProvider,
  type TravelportStaysCredentials,
  type TravelportStaysEnvironment,
} from './travelport-stays-provider-core.ts';

export {
  travelportStaysEnvironments,
  TravelportStaysConfigurationError,
  type TravelportStaysCredentials,
  type TravelportStaysEnvironment,
};

const MAX_REFERENCE_LENGTH = 4_096;
const MAX_ACCESS_TOKEN_LENGTH = 16_384;
const DOCUMENTED_ACCESS_TOKEN_LIFETIME_SECONDS = 86_400;
const MAX_CONFIGURATION_IDENTIFIER_LENGTH = 512;
const MAX_CONFIGURATION_SECRET_LENGTH = 4_096;
const MAX_SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 5;
const MAX_SEARCH_ITEMS = MAX_SEARCH_PAGE_SIZE * MAX_SEARCH_PAGES;
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const CANONICAL_OAUTH_EXPIRY_PATTERN = /^[1-9]\d{0,4}$/;
const TRAVELPORT_OAUTH_HOSTS = new Set(['auth.pp.travelport.net', 'auth.travelport.net']);

type ReferenceRecord = Readonly<Record<string, unknown>>;

function invalidRequest(message = 'Supplier reference is invalid.'): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', message);
}

function invalidResponse(message = 'Travelport returned invalid machine evidence.'): never {
  throw new HospitalitySupplierProviderError('INVALID_RESPONSE', message);
}

function exactMachineToken(
  value: unknown,
  max: number,
  failure: 'request' | 'response',
): string {
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.length > max
    || ASCII_CONTROL_PATTERN.test(value)
  ) {
    if (failure === 'request') invalidRequest();
    invalidResponse();
  }
  return value;
}

function exactConfigurationValue(value: unknown, label: string, max: number): string {
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.length > max
    || ASCII_CONTROL_PATTERN.test(value)
  ) {
    throw new TravelportStaysConfigurationError(`${label} is invalid.`);
  }
  return value;
}

export function normalizeTravelportStaysConfiguration(
  input: Parameters<typeof normalizeTravelportStaysConfigurationCore>[0],
): ReturnType<typeof normalizeTravelportStaysConfigurationCore> {
  exactConfigurationValue(input.username, 'Travelport username', MAX_CONFIGURATION_IDENTIFIER_LENGTH);
  exactConfigurationValue(input.password, 'Travelport password', MAX_CONFIGURATION_SECRET_LENGTH);
  exactConfigurationValue(input.clientId, 'Travelport client ID', MAX_CONFIGURATION_IDENTIFIER_LENGTH);
  exactConfigurationValue(input.clientSecret, 'Travelport client secret', MAX_CONFIGURATION_SECRET_LENGTH);
  exactConfigurationValue(input.accessGroup, 'Travelport access group', MAX_CONFIGURATION_IDENTIFIER_LENGTH);
  return normalizeTravelportStaysConfigurationCore(input);
}

export function readTravelportStaysCredentials(
  credentials: Readonly<Record<string, string>>,
): TravelportStaysCredentials {
  return normalizeTravelportStaysConfiguration({
    environment: credentials.environment,
    username: credentials.username,
    password: credentials.password,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    accessGroup: credentials.accessGroup,
  }).credentials;
}

function canonicalReference(value: unknown): ReferenceRecord {
  if (
    typeof value !== 'string'
    || !value
    || value.length > MAX_REFERENCE_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    invalidRequest();
  }
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) invalidRequest();
    const decoded = JSON.parse(bytes.toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) invalidRequest();
    return decoded as ReferenceRecord;
  } catch (error) {
    if (error instanceof HospitalitySupplierProviderError) throw error;
    invalidRequest();
  }
}

export function assertTravelportStaysPropertyReference(value: unknown): void {
  const property = canonicalReference(value);
  if (
    property.authority !== 'TVPT'
    || typeof property.chainCode !== 'string'
    || typeof property.propertyCode !== 'string'
    || !/^[A-Za-z0-9]{1,16}$/.test(property.chainCode)
    || !/^[A-Za-z0-9]{1,32}$/.test(property.propertyCode)
  ) {
    invalidRequest('Supplier property reference is invalid.');
  }
}

export function assertTravelportStaysOfferReference(value: unknown): void {
  const offer = canonicalReference(value);
  if (
    offer.propertyAuthority !== 'TVPT'
    || (offer.rateAuthority !== 'TVPT' && offer.rateAuthority !== 'BKNG')
    || typeof offer.chainCode !== 'string'
    || typeof offer.propertyCode !== 'string'
    || !/^[A-Za-z0-9]{1,16}$/.test(offer.chainCode)
    || !/^[A-Za-z0-9]{1,32}$/.test(offer.propertyCode)
  ) {
    invalidRequest('Supplier offer reference is invalid.');
  }
  exactMachineToken(offer.rateValue, MAX_REFERENCE_LENGTH, 'request');
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function isTravelportOAuthRequest(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      && TRAVELPORT_OAUTH_HOSTS.has(parsed.hostname)
      && parsed.pathname === '/oauth/token';
  } catch {
    return false;
  }
}

function searchCompleteRequestAuthority(url: string): Readonly<{ expectedPage: number; initial: boolean }> {
  try {
    const parsed = new URL(url);
    const initialPath = '/12/hotel/search/searchcomplete';
    if (parsed.pathname === initialPath) {
      if (parsed.search) invalidResponse('Travelport SearchComplete request authority is invalid.');
      return Object.freeze({ expectedPage: 1, initial: true });
    }

    if (!parsed.pathname.startsWith(`${initialPath}/`)) {
      invalidResponse('Travelport SearchComplete request authority is invalid.');
    }
    const identifier = parsed.pathname.slice(initialPath.length + 1);
    const queryEntries = [...parsed.searchParams.entries()];
    if (
      !identifier
      || identifier.includes('/')
      || queryEntries.length !== 1
      || queryEntries[0]?.[0] !== 'pageNumber'
      || !/^[2-5]$/.test(queryEntries[0]?.[1] ?? '')
    ) {
      invalidResponse('Travelport SearchComplete request authority is invalid.');
    }
    return Object.freeze({ expectedPage: Number(queryEntries[0]?.[1]), initial: false });
  } catch (error) {
    if (error instanceof HospitalitySupplierProviderError) throw error;
    invalidResponse('Travelport SearchComplete request authority is invalid.');
  }
}

function validateOAuthExpiresInIfPresent(value: unknown): void {
  if (value === undefined) return;

  if (typeof value === 'number') {
    if (
      !Number.isSafeInteger(value)
      || value < 1
      || value > DOCUMENTED_ACCESS_TOKEN_LIFETIME_SECONDS
    ) {
      invalidResponse('Travelport OAuth token expiry metadata is invalid.');
    }
    return;
  }

  if (
    typeof value !== 'string'
    || !CANONICAL_OAUTH_EXPIRY_PATTERN.test(value)
  ) {
    invalidResponse('Travelport OAuth token expiry metadata is invalid.');
  }
  const seconds = Number(value);
  if (
    !Number.isSafeInteger(seconds)
    || seconds < 1
    || seconds > DOCUMENTED_ACCESS_TOKEN_LIFETIME_SECONDS
    || String(seconds) !== value
  ) {
    invalidResponse('Travelport OAuth token expiry metadata is invalid.');
  }
}

async function validateOAuthAccessTokenResponse(response: Response): Promise<void> {
  const payload = await response.clone().json().catch(() => null);
  const object = record(payload);
  if (!object) return;
  exactMachineToken(object.access_token, MAX_ACCESS_TOKEN_LENGTH, 'response');
  validateOAuthExpiresInIfPresent(object.expires_in);
}

function exactResponseTokenIfPresent(value: unknown, max: number): void {
  if (typeof value === 'string') exactMachineToken(value, max, 'response');
}

function validatePagination(value: unknown): void {
  const pagination = record(value);
  if (!pagination) return;

  const page = pagination.page;
  const pageSize = pagination.pageSize;
  const totalPages = pagination.totalPages;
  const totalItems = pagination.totalItems;
  if (
    !Number.isInteger(page)
    || !Number.isInteger(pageSize)
    || !Number.isInteger(totalPages)
    || !Number.isInteger(totalItems)
  ) {
    invalidResponse('Travelport pagination metadata is invalid or oversized.');
  }

  const currentPage = page as number;
  const currentPageSize = pageSize as number;
  const pageCount = totalPages as number;
  const itemCount = totalItems as number;
  if (
    currentPage < 1
    || currentPage > MAX_SEARCH_PAGES
    || currentPageSize < 0
    || currentPageSize > MAX_SEARCH_PAGE_SIZE
    || pageCount < 0
    || pageCount > MAX_SEARCH_PAGES
    || itemCount < 0
    || itemCount > MAX_SEARCH_ITEMS
    || (itemCount > 0 && (currentPageSize < 1 || pageCount < 1))
    || (pageCount === 0 && currentPage !== 1)
    || (pageCount > 0 && currentPage > pageCount)
    || (pageCount > 0 && itemCount > pageCount * MAX_SEARCH_PAGE_SIZE)
  ) {
    invalidResponse('Travelport pagination metadata is invalid or oversized.');
  }

  if (pagination.paginationToken === undefined) return;
  exactMachineToken(pagination.paginationToken, MAX_REFERENCE_LENGTH, 'response');
}

function validateRate(value: unknown): void {
  const rate = record(value);
  if (!rate) return;
  const rateKey = record(rate.rateKey);
  if (rateKey) exactResponseTokenIfPresent(rateKey.value, MAX_REFERENCE_LENGTH);
  exactResponseTokenIfPresent(rate.bookingCode, 512);

  const rateCodeInfo = record(rate.rateCodeInfo);
  if (rateCodeInfo) {
    exactResponseTokenIfPresent(rateCodeInfo.rateCode, 256);
    exactResponseTokenIfPresent(rateCodeInfo.ratePlanID, 256);
    exactResponseTokenIfPresent(rateCodeInfo.rateCategory, 128);
  }

  const price = record(rate.price);
  if (price) validateCurrencyCodeIfPresent(price.currencyCode);

  const terms = record(rate.terms);
  if (terms && Array.isArray(terms.cancelPenalties)) {
    for (const penaltyValue of terms.cancelPenalties) {
      const penalty = record(penaltyValue);
      const providerPenalty = penalty ? record(penalty.penalty) : null;
      const currencyAmount = providerPenalty ? record(providerPenalty.currencyAmount) : null;
      if (currencyAmount) validateCurrencyCodeIfPresent(currencyAmount.currency);
    }
  }
}

function validatePropertyItem(value: unknown): void {
  const property = record(value);
  if (!property) return;
  exactResponseTokenIfPresent(property.chainCode, 16);
  exactResponseTokenIfPresent(property.propertyCode, 32);

  if (!Array.isArray(property.roomTypes)) return;
  for (const roomValue of property.roomTypes) {
    const room = record(roomValue);
    if (!room || !Array.isArray(room.rates)) continue;
    for (const rate of room.rates) validateRate(rate);
  }
}

function validateSearchCompleteResponse(value: unknown, url: string): void {
  const requestAuthority = searchCompleteRequestAuthority(url);
  const root = record(value);
  if (!root) return;
  validatePagination(root.pagination);

  const pagination = record(root.pagination);
  if (!pagination) return;
  const currentPage = pagination.page as number;
  const pageCount = pagination.totalPages as number;
  if (currentPage !== requestAuthority.expectedPage) {
    invalidResponse('Travelport SearchComplete response page does not match the request.');
  }
  if (
    requestAuthority.initial
    && (pageCount > 1) !== (pagination.paginationToken !== undefined)
  ) {
    invalidResponse('Travelport SearchComplete pagination token authority is inconsistent.');
  }

  const hotelsResponse = record(root.hotelsResponse);
  if (!hotelsResponse || !Array.isArray(hotelsResponse.propertyItems)) return;
  for (const property of hotelsResponse.propertyItems) validatePropertyItem(property);
}

function validateCurrencyCodeIfPresent(value: unknown): void {
  if (typeof value !== 'string') return;
  if (!/^[A-Z]{3}$/.test(value)) invalidResponse('Travelport currency code is invalid.');
}

function validateRulesMoneyCurrency(value: unknown): void {
  const money = record(value);
  if (money) validateCurrencyCodeIfPresent(money.code);
}

function validateRulesTerms(value: unknown): void {
  const block = record(value);
  if (!block) return;

  if (Array.isArray(block.AcceptedCreditCard)) {
    for (const cardValue of block.AcceptedCreditCard) {
      const card = record(cardValue);
      if (card) exactResponseTokenIfPresent(card.value, 16);
    }
  }

  const depositPolicy = block.DepositPolicy;
  const policies = Array.isArray(depositPolicy) ? depositPolicy : depositPolicy == null ? [] : [depositPolicy];
  for (const policyValue of policies) {
    const policy = record(policyValue);
    if (!policy) continue;
    const deposits = Array.isArray(policy.Deposit) ? policy.Deposit : policy.Deposit == null ? [] : [policy.Deposit];
    for (const depositValue of deposits) {
      const deposit = record(depositValue);
      if (deposit) validateRulesMoneyCurrency(deposit.CurrencyAmount);
    }
  }

  if (!Array.isArray(block.CancelPenalty)) return;
  for (const cancellationValue of block.CancelPenalty) {
    const cancellation = record(cancellationValue);
    if (!cancellation) continue;
    const penalty = record(cancellation.HotelPenalty);
    if (!penalty) continue;
    const amounts = Array.isArray(penalty.Amount) ? penalty.Amount : penalty.Amount == null ? [] : [penalty.Amount];
    for (const amount of amounts) validateRulesMoneyCurrency(amount);
  }
}

function validateRulesResponse(value: unknown): void {
  const root = record(value);
  const response = root ? record(root.OfferHospitalityResponse) : null;
  if (!response) return;
  const rawOffer = response.Offer;
  const offers = Array.isArray(rawOffer) ? rawOffer : rawOffer == null ? [] : [rawOffer];

  for (const offerValue of offers) {
    const offer = record(offerValue);
    if (!offer) continue;
    const price = record(offer.Price);
    const currencyCode = price ? record(price.CurrencyCode) : null;
    if (currencyCode) validateCurrencyCodeIfPresent(currencyCode.value);

    if (Array.isArray(offer.Product)) {
      for (const productValue of offer.Product) {
        const product = record(productValue);
        if (!product) continue;
        exactResponseTokenIfPresent(product.bookingCode, 512);
        const propertyKey = record(product.PropertyKey);
        if (propertyKey) {
          exactResponseTokenIfPresent(propertyKey.chainCode, 16);
          exactResponseTokenIfPresent(propertyKey.propertyCode, 32);
        }
      }
    }

    if (Array.isArray(offer.TermsAndConditionsFull)) {
      for (const terms of offer.TermsAndConditionsFull) validateRulesTerms(terms);
    }
  }
}

export function createTravelportStaysReferenceAuthorityFetch(
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return (async (input, init) => {
    const response = await fetchImpl(input, init);
    if (!response.ok) return response;

    const url = requestUrl(input);
    if (isTravelportOAuthRequest(url)) {
      await validateOAuthAccessTokenResponse(response);
      return response;
    }
    if (!url.includes('/hotel/')) return response;

    const payload = await response.clone().json().catch(() => null);
    if (payload === null) return response;

    if (url.includes('/search/searchcomplete')) {
      validateSearchCompleteResponse(payload, url);
      assertTravelportStaysSearchCommercialAuthorityResponse(payload);
    }
    if (url.includes('/rules/offershospitality/')) {
      validateRulesResponse(payload);
      assertTravelportStaysRulesCommercialAuthorityResponse(payload);
    }
    return response;
  }) as typeof fetch;
}

export function requestTravelportStaysAccessToken(
  input: Parameters<typeof requestTravelportStaysAccessTokenCore>[0],
): ReturnType<typeof requestTravelportStaysAccessTokenCore> {
  return requestTravelportStaysAccessTokenCore({
    ...input,
    fetchImpl: createTravelportStaysReferenceAuthorityFetch(input.fetchImpl ?? fetch),
  });
}

export function probeTravelportStaysIntegrationHealth(
  input: Parameters<typeof probeTravelportStaysIntegrationHealthCore>[0],
): ReturnType<typeof probeTravelportStaysIntegrationHealthCore> {
  return probeTravelportStaysIntegrationHealthCore({
    ...input,
    fetchImpl: createTravelportStaysReferenceAuthorityFetch(input.fetchImpl ?? fetch),
  });
}

export class TravelportStaysProvider extends CoreTravelportStaysProvider {
  constructor(input: {
    credentials: TravelportStaysCredentials;
    cacheKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  }) {
    super({
      ...input,
      fetchImpl: createTravelportStaysReferenceAuthorityFetch(input.fetchImpl ?? fetch),
    });
  }

  override async searchPropertiesPage(
    input: HospitalitySupplierSearchPageInput,
  ): Promise<HospitalitySupplierSearchResult> {
    exactMachineToken(input.pageToken, MAX_REFERENCE_LENGTH, 'request');
    return super.searchPropertiesPage(input);
  }

  override async searchPropertyOffers(
    input: HospitalitySupplierOfferSearchInput,
  ): Promise<HospitalitySupplierOfferSearchResult> {
    assertTravelportStaysPropertyReference(input.supplierPropertyReference);
    return super.searchPropertyOffers(input);
  }

  override async revalidatePropertyOffer(
    input: HospitalitySupplierOfferRevalidationInput,
  ): Promise<HospitalitySupplierOfferRevalidationResult> {
    assertTravelportStaysPropertyReference(input.supplierPropertyReference);
    assertTravelportStaysOfferReference(input.supplierOfferReference);
    return super.revalidatePropertyOffer(input);
  }
}
