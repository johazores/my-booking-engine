import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const MAX_REFERENCE_LENGTH = 4_096;
const MAX_CACHE_KEY_LENGTH = 512;
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type UnknownRecord = Readonly<Record<string, unknown>>;

function invalidRequest(message: string): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', message);
}

function invalidResponse(message = 'Travelport returned invalid reservation authority evidence.'): never {
  throw new HospitalitySupplierProviderError('INVALID_RESPONSE', message);
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function validateExactMachineStringIfPresent(value: unknown, max: number): void {
  if (value === undefined || value === null) return;
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.length > max
    || ASCII_CONTROL_PATTERN.test(value)
  ) {
    invalidResponse();
  }
}

function validateCurrencyIfPresent(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !CURRENCY_CODE_PATTERN.test(value)) {
    invalidResponse('Travelport returned an invalid currency code.');
  }
}

function validateMoneyIfPresent(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidResponse('Travelport returned an invalid money value.');
    return;
  }
  validateExactMachineStringIfPresent(value, 128);
}

function validateLocalDateIfPresent(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !LOCAL_DATE_PATTERN.test(value)) invalidResponse();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalidResponse();
}

function validateSearchCompleteRate(value: unknown): void {
  const rate = record(value);
  if (!rate) return;

  const rateKey = record(rate.rateKey);
  if (rateKey) {
    validateExactMachineStringIfPresent(rateKey.value, MAX_REFERENCE_LENGTH);
    validateExactMachineStringIfPresent(rateKey.authority, 16);
  }

  validateExactMachineStringIfPresent(rate.bookingCode, 512);

  const rateCodeInfo = record(rate.rateCodeInfo);
  if (rateCodeInfo) {
    validateExactMachineStringIfPresent(rateCodeInfo.rateCode, 256);
    validateExactMachineStringIfPresent(rateCodeInfo.ratePlanID, 256);
    validateExactMachineStringIfPresent(rateCodeInfo.rateCategory, 128);
  }

  const price = record(rate.price);
  if (price) {
    validateCurrencyIfPresent(price.currencyCode);
    validateMoneyIfPresent(record(price.totalPrice)?.amount);
  }
}

function validateSearchCompleteResponse(value: unknown): void {
  const root = record(value);
  const hotelsResponse = root ? record(root.hotelsResponse) : null;
  if (!hotelsResponse) return;

  for (const propertyValue of array(hotelsResponse.propertyItems)) {
    const property = record(propertyValue);
    if (!property) continue;
    validateExactMachineStringIfPresent(property.chainCode, 16);
    validateExactMachineStringIfPresent(property.propertyCode, 32);

    for (const roomValue of array(property.roomTypes)) {
      const room = record(roomValue);
      if (!room) continue;
      for (const rateValue of array(room.rates)) validateSearchCompleteRate(rateValue);
    }
  }
}

function validateAvailabilityProduct(value: unknown): void {
  const product = record(value);
  if (!product) return;

  validateExactMachineStringIfPresent(product.bookingCode, 512);

  const propertyKey = record(product.PropertyKey);
  if (propertyKey) {
    validateExactMachineStringIfPresent(propertyKey.chainCode, 16);
    validateExactMachineStringIfPresent(propertyKey.propertyCode, 32);
  }

  const dateRange = record(product.DateRange);
  if (dateRange) {
    validateLocalDateIfPresent(dateRange.start);
    validateLocalDateIfPresent(dateRange.end);
  }
}

function validateAvailabilityOffering(value: unknown): void {
  const offering = record(value);
  if (!offering) return;

  validateExactMachineStringIfPresent(offering.id, MAX_REFERENCE_LENGTH);

  const identifier = record(offering.Identifier);
  if (identifier) {
    validateExactMachineStringIfPresent(identifier.value, MAX_REFERENCE_LENGTH);
    validateExactMachineStringIfPresent(identifier.authority, 16);
  }

  const terms = record(offering.TermsAndConditions);
  const rateInfoContainer = terms ? record(terms.ProductRateCodeInfo) : null;
  const rateInfo = rateInfoContainer ? record(rateInfoContainer.RateCodeInfo) : null;
  if (rateInfo) {
    validateExactMachineStringIfPresent(rateInfo.value, 256);
    validateExactMachineStringIfPresent(rateInfo.rateID, 256);
    validateExactMachineStringIfPresent(rateInfo.rateCategory, 128);
  }

  for (const optionValue of array(offering.ProductOptions)) {
    const option = record(optionValue);
    if (!option) continue;
    for (const productValue of array(option.Product)) validateAvailabilityProduct(productValue);
  }
}

function validateAvailabilityResponse(value: unknown): void {
  const root = record(value);
  const response = root ? record(root.CatalogOfferingsHospitalityResponse) : null;
  const catalog = response ? record(response.CatalogOfferings) : null;
  if (!catalog) return;

  const paginationIdentifier = record(catalog.Identifier);
  if (paginationIdentifier) validateExactMachineStringIfPresent(paginationIdentifier.value, MAX_REFERENCE_LENGTH);
  for (const offering of array(catalog.CatalogOffering)) validateAvailabilityOffering(offering);
}

export function assertTravelportStaysReservationAuthorityCacheKey(value: unknown): asserts value is string {
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.length > MAX_CACHE_KEY_LENGTH
    || ASCII_CONTROL_PATTERN.test(value)
  ) {
    invalidRequest('Reservation authority cache key is invalid.');
  }
}

export function createTravelportStaysReservationAuthorityResponseFetch(
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
    if (url.includes('/availability/catalogofferingshospitality')) validateAvailabilityResponse(payload);
    return response;
  }) as typeof fetch;
}
