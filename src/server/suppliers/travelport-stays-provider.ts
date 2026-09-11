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
  TravelportStaysProvider as CoreTravelportStaysProvider,
  type TravelportStaysCredentials,
} from './travelport-stays-provider-core.ts';

export {
  normalizeTravelportStaysConfiguration,
  probeTravelportStaysIntegrationHealth,
  readTravelportStaysCredentials,
  requestTravelportStaysAccessToken,
  travelportStaysEnvironments,
  TravelportStaysConfigurationError,
  type TravelportStaysCredentials,
  type TravelportStaysEnvironment,
} from './travelport-stays-provider-core.ts';

const MAX_REFERENCE_LENGTH = 4_096;
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

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

function exactResponseTokenIfPresent(value: unknown, max: number): void {
  if (typeof value === 'string') exactMachineToken(value, max, 'response');
}

function validatePagination(value: unknown): void {
  const pagination = record(value);
  if (!pagination || pagination.paginationToken === undefined) return;
  if (typeof pagination.paginationToken !== 'string') return;
  if (
    pagination.paginationToken.length > MAX_REFERENCE_LENGTH
    || ASCII_CONTROL_PATTERN.test(pagination.paginationToken)
  ) {
    invalidResponse('Travelport pagination token is invalid.');
  }
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

function validateSearchCompleteResponse(value: unknown): void {
  const root = record(value);
  if (!root) return;
  validatePagination(root.pagination);

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

    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (!url.includes('/hotel/')) return response;

    const payload = await response.clone().json().catch(() => null);
    if (payload === null) return response;

    if (url.includes('/search/searchcomplete')) validateSearchCompleteResponse(payload);
    if (url.includes('/rules/offershospitality/')) validateRulesResponse(payload);
    return response;
  }) as typeof fetch;
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
    if (
      typeof input.pageToken !== 'string'
      || !input.pageToken
      || input.pageToken.length > MAX_REFERENCE_LENGTH
      || ASCII_CONTROL_PATTERN.test(input.pageToken)
    ) {
      invalidRequest('Search page token is invalid.');
    }
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
