import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const RULES_PATH = '/11/hotel/rules/offershospitality/buildfromrequest';
const RULES_HOSTS = new Set(['api.pp.travelport.net', 'api.travelport.net']);
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BOOKING_CODE_LENGTH = 512;
const MAX_CHAIN_CODE_LENGTH = 16;
const MAX_PROPERTY_CODE_LENGTH = 32;
const MAX_RULE_PRODUCTS = 8;

type RecordValue = Readonly<Record<string, unknown>>;

type RulesSelectionAuthority = Readonly<{
  bookingCode: string;
  chainCode: string;
  propertyCode: string;
  checkInDateLocal: string;
  checkOutDateLocal: string;
  numberOfGuests: number;
  rateAuthority: 'TVPT' | 'BKNG';
}>;

function invalidResponse(message = 'Travelport returned invalid Rules selection authority evidence.'): never {
  throw new HospitalitySupplierProviderError('INVALID_RESPONSE', message);
}

function record(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function exactMachineString(value: unknown, max: number, label: string): string {
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.length > max
    || ASCII_CONTROL_PATTERN.test(value)
  ) {
    invalidResponse(`Travelport Rules ${label} authority is invalid.`);
  }
  return value;
}

function canonicalLocalDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !LOCAL_DATE_PATTERN.test(value)) {
    invalidResponse(`Travelport Rules ${label} authority is invalid.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    invalidResponse(`Travelport Rules ${label} authority is invalid.`);
  }
  return value;
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return init?.method ?? (input instanceof Request ? input.method : 'GET');
}

function rulesSelectionAuthorityForRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): RulesSelectionAuthority | null {
  let url: URL;
  try {
    url = new URL(requestUrl(input));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !RULES_HOSTS.has(url.hostname) || url.pathname !== RULES_PATH) {
    return null;
  }
  if (requestMethod(input, init) !== 'POST' || url.search) {
    invalidResponse('Travelport Rules request authority is invalid.');
  }
  if (typeof init?.body !== 'string') {
    invalidResponse('Travelport Rules request body authority is invalid.');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(init.body);
  } catch {
    invalidResponse('Travelport Rules request body authority is invalid.');
  }
  const root = record(payload);
  const request = root ? record(root.OfferQueryHospitalityRequest) : null;
  const propertyKey = request ? record(request.PropertyKey) : null;
  if (!request || !propertyKey) {
    invalidResponse('Travelport Rules request selection authority is incomplete.');
  }

  const hotelAggregator = request.HotelAggregator;
  const rateAuthority = hotelAggregator === 'Travelport'
    ? 'TVPT'
    : hotelAggregator === 'Booking'
      ? 'BKNG'
      : null;
  if (!rateAuthority) {
    invalidResponse('Travelport Rules rate-source authority is invalid.');
  }

  const numberOfGuests = request.numberOfGuests;
  if (!Number.isSafeInteger(numberOfGuests) || (numberOfGuests as number) < 1 || (numberOfGuests as number) > 9) {
    invalidResponse('Travelport Rules guest-count authority is invalid.');
  }

  return Object.freeze({
    bookingCode: exactMachineString(request.bookingCode, MAX_BOOKING_CODE_LENGTH, 'booking-code'),
    chainCode: exactMachineString(propertyKey.chainCode, MAX_CHAIN_CODE_LENGTH, 'chain-code'),
    propertyCode: exactMachineString(propertyKey.propertyCode, MAX_PROPERTY_CODE_LENGTH, 'property-code'),
    checkInDateLocal: canonicalLocalDate(request.checkinDate, 'check-in'),
    checkOutDateLocal: canonicalLocalDate(request.checkoutDate, 'check-out'),
    numberOfGuests: numberOfGuests as number,
    rateAuthority,
  });
}

function oneRulesOffer(response: RecordValue): RecordValue {
  const rawOffer = response.Offer;
  const offers = Array.isArray(rawOffer)
    ? rawOffer
    : rawOffer === undefined || rawOffer === null
      ? []
      : [rawOffer];
  if (offers.length !== 1) {
    invalidResponse('Travelport Rules response must contain exactly one offer.');
  }
  const offer = record(offers[0]);
  if (!offer) invalidResponse('Travelport Rules response offer is malformed.');
  return offer;
}

function matchesExpectedProduct(product: RecordValue, expected: RulesSelectionAuthority): boolean {
  const propertyKey = record(product.PropertyKey);
  const dateRange = record(product.DateRange);
  return !!propertyKey
    && !!dateRange
    && product.bookingCode === expected.bookingCode
    && propertyKey.chainCode === expected.chainCode
    && propertyKey.propertyCode === expected.propertyCode
    && dateRange.start === expected.checkInDateLocal
    && dateRange.end === expected.checkOutDateLocal;
}

function assertRulesSelectionResponse(value: unknown, expected: RulesSelectionAuthority): void {
  const root = record(value);
  const response = root ? record(root.OfferHospitalityResponse) : null;
  if (!response) invalidResponse('Travelport Rules response envelope is missing.');

  if (response.Identifier !== undefined && response.Identifier !== null) {
    const identifier = record(response.Identifier);
    if (!identifier || identifier.authority !== expected.rateAuthority) {
      invalidResponse('Travelport Rules response rate source does not match the selected offer.');
    }
  }

  const offer = oneRulesOffer(response);
  if (!Array.isArray(offer.Product) || offer.Product.length < 1 || offer.Product.length > MAX_RULE_PRODUCTS) {
    invalidResponse('Travelport Rules response products are invalid or oversized.');
  }

  const matchingProducts: RecordValue[] = [];
  for (const productValue of offer.Product) {
    const product = record(productValue);
    if (!product) invalidResponse('Travelport Rules response product is malformed.');
    if (matchesExpectedProduct(product, expected)) matchingProducts.push(product);
  }
  if (matchingProducts.length !== 1) {
    invalidResponse('Travelport Rules response does not identify exactly one selected product.');
  }

  const guests = matchingProducts[0]!.guests;
  if (
    guests !== undefined
    && guests !== null
    && (!Number.isSafeInteger(guests) || guests !== expected.numberOfGuests)
  ) {
    invalidResponse('Travelport Rules response guest count does not match the selected stay.');
  }
}

export function createTravelportStaysRulesSelectionAuthorityFetch(fetchImpl: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const expected = rulesSelectionAuthorityForRequest(input, init);
    const response = await fetchImpl(input, init);
    if (!expected || !response.ok) return response;

    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      invalidResponse('Travelport Rules response is not valid JSON.');
    }
    assertRulesSelectionResponse(payload, expected);
    return response;
  }) as typeof fetch;
}
