import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const MAX_REFERENCE_LENGTH = 4_096;
const MAX_CACHE_KEY_LENGTH = 512;
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SEARCH_PROPERTIES = 1;
const MAX_ROOM_TYPES = 128;
const MAX_RATES = 256;
const MAX_AVAILABILITY_PAGES = 5;
const MAX_AVAILABILITY_OFFERS = 100;
const MAX_AVAILABILITY_TOTAL_OFFERS = MAX_AVAILABILITY_PAGES * MAX_AVAILABILITY_OFFERS;
const MAX_PRODUCT_OPTIONS = 16;
const MAX_PRODUCTS = 16;
const SEARCH_COMPLETE_PATH = '/12/hotel/search/searchcomplete';
const AVAILABILITY_PATH = '/11/hotel/availability/catalogofferingshospitality';

type UnknownRecord = Readonly<Record<string, unknown>>;
type ReservationAuthorityRequest = Readonly<{
  kind: 'search-complete' | 'availability';
  pageNumber: number;
  initial: boolean;
}>;

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

function boundedArray(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  if (value.length > max) invalidResponse('Travelport returned an oversized reservation authority collection.');
  return value;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function requestMethod(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function hasCanonicalQueryEncoding(url: URL): boolean {
  return url.search === '' || url.search === `?${url.searchParams.toString()}`;
}

function hasSingleCanonicalEncodedPathSegment(url: URL, prefix: string): boolean {
  if (!url.pathname.startsWith(prefix)) return false;
  const suffix = url.pathname.slice(prefix.length);
  if (!suffix || suffix.includes('/')) return false;
  try {
    return encodeURIComponent(decodeURIComponent(suffix)) === suffix;
  } catch {
    return false;
  }
}

function reservationAuthorityRequest(
  rawUrl: string,
  method: string,
): ReservationAuthorityRequest | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.pathname === SEARCH_COMPLETE_PATH || url.pathname.startsWith(`${SEARCH_COMPLETE_PATH}/`)) {
    if (url.pathname !== SEARCH_COMPLETE_PATH || method !== 'POST' || url.search !== '') {
      invalidResponse('Travelport reservation SearchComplete request authority is invalid.');
    }
    return Object.freeze({ kind: 'search-complete', pageNumber: 1, initial: true });
  }

  if (url.pathname === AVAILABILITY_PATH) {
    if (method !== 'POST' || url.search !== '') {
      invalidResponse('Travelport reservation Availability request authority is invalid.');
    }
    return Object.freeze({ kind: 'availability', pageNumber: 1, initial: true });
  }

  if (url.pathname.startsWith(`${AVAILABILITY_PATH}/`)) {
    const queryEntries = [...url.searchParams.entries()];
    if (
      method !== 'GET'
      || !hasSingleCanonicalEncodedPathSegment(url, `${AVAILABILITY_PATH}/`)
      || !hasCanonicalQueryEncoding(url)
      || queryEntries.length !== 1
      || queryEntries[0]?.[0] !== 'pageNumber'
      || !/^[2-5]$/.test(queryEntries[0]?.[1] ?? '')
    ) {
      invalidResponse('Travelport reservation Availability request authority is invalid.');
    }
    return Object.freeze({
      kind: 'availability',
      pageNumber: Number(queryEntries[0]?.[1]),
      initial: false,
    });
  }

  return null;
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
  const pagination = root ? record(root.pagination) : null;
  const hotelsResponse = root ? record(root.hotelsResponse) : null;
  if (!root || !pagination || !hotelsResponse || !Array.isArray(hotelsResponse.propertyItems)) {
    invalidResponse('Travelport reservation SearchComplete response envelope is invalid.');
  }

  if (
    pagination.page !== 1
    || pagination.pageSize !== MAX_SEARCH_PROPERTIES
    || pagination.totalPages !== 1
    || pagination.totalItems !== MAX_SEARCH_PROPERTIES
    || pagination.paginationToken !== undefined
  ) {
    invalidResponse('Travelport reservation SearchComplete pagination authority is invalid.');
  }

  const properties = boundedArray(hotelsResponse.propertyItems, MAX_SEARCH_PROPERTIES);
  if (properties.length !== MAX_SEARCH_PROPERTIES) {
    invalidResponse('Travelport reservation SearchComplete property authority is invalid.');
  }

  for (const propertyValue of properties) {
    const property = record(propertyValue);
    if (!property) continue;
    validateExactMachineStringIfPresent(property.chainCode, 16);
    validateExactMachineStringIfPresent(property.propertyCode, 32);

    for (const roomValue of boundedArray(property.roomTypes, MAX_ROOM_TYPES)) {
      const room = record(roomValue);
      if (!room) continue;
      for (const rateValue of boundedArray(room.rates, MAX_RATES)) validateSearchCompleteRate(rateValue);
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

  for (const optionValue of boundedArray(offering.ProductOptions, MAX_PRODUCT_OPTIONS)) {
    const option = record(optionValue);
    if (!option) continue;
    for (const productValue of boundedArray(option.Product, MAX_PRODUCTS)) validateAvailabilityProduct(productValue);
  }
}

function validateAvailabilityResponse(
  value: unknown,
  requestAuthority: ReservationAuthorityRequest,
): void {
  const root = record(value);
  const response = root ? record(root.CatalogOfferingsHospitalityResponse) : null;
  const catalog = response ? record(response.CatalogOfferings) : null;
  if (!root || !response || !catalog) {
    invalidResponse('Travelport reservation Availability response envelope is invalid.');
  }

  const total = catalog.totalCatalogOffering;
  const pageSize = catalog.catalogOfferingPerPage;
  const pageCount = catalog.numberOfPages;
  if (
    !Number.isInteger(total)
    || !Number.isInteger(pageSize)
    || !Number.isInteger(pageCount)
  ) {
    invalidResponse('Travelport Availability pagination metadata is invalid.');
  }

  const totalOffers = total as number;
  const returnedOffers = pageSize as number;
  const totalPages = pageCount as number;
  const expectedPages = Math.max(1, Math.ceil(totalOffers / MAX_AVAILABILITY_OFFERS));
  if (
    totalOffers < 0
    || totalOffers > MAX_AVAILABILITY_TOTAL_OFFERS
    || returnedOffers < 0
    || returnedOffers > MAX_AVAILABILITY_OFFERS
    || totalPages < 1
    || totalPages > MAX_AVAILABILITY_PAGES
    || totalPages !== expectedPages
    || requestAuthority.pageNumber > totalPages
  ) {
    invalidResponse('Travelport Availability pagination metadata is invalid.');
  }

  const remainingOffers = Math.max(
    0,
    totalOffers - ((requestAuthority.pageNumber - 1) * MAX_AVAILABILITY_OFFERS),
  );
  const expectedPageSize = Math.min(MAX_AVAILABILITY_OFFERS, remainingOffers);
  const offerings = boundedArray(catalog.CatalogOffering, MAX_AVAILABILITY_OFFERS);
  if (returnedOffers !== expectedPageSize || offerings.length !== expectedPageSize) {
    invalidResponse('Travelport Availability page size does not match its pagination authority.');
  }

  const paginationIdentifier = record(catalog.Identifier);
  if (requestAuthority.initial) {
    if (totalPages > 1) {
      if (!paginationIdentifier) {
        invalidResponse('Travelport Availability pagination identifier is missing.');
      }
      validateExactMachineStringIfPresent(paginationIdentifier.value, MAX_REFERENCE_LENGTH);
    } else if (catalog.Identifier !== undefined && catalog.Identifier !== null) {
      invalidResponse('Travelport Availability pagination identifier is unexpected.');
    }
  } else if (paginationIdentifier) {
    validateExactMachineStringIfPresent(paginationIdentifier.value, MAX_REFERENCE_LENGTH);
  }

  for (const offering of offerings) validateAvailabilityOffering(offering);
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
    const url = requestUrl(input);
    const requestAuthority = reservationAuthorityRequest(url, requestMethod(input, init));
    const response = await fetchImpl(input, init);
    if (!response.ok || requestAuthority === null) return response;

    const payload = await response.clone().json().catch(() => null);
    if (payload === null) {
      invalidResponse('Travelport reservation authority response is not valid JSON.');
    }

    if (requestAuthority.kind === 'search-complete') validateSearchCompleteResponse(payload);
    if (requestAuthority.kind === 'availability') validateAvailabilityResponse(payload, requestAuthority);
    return response;
  }) as typeof fetch;
}
