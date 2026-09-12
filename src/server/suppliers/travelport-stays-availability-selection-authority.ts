import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const AVAILABILITY_PATH = '/11/hotel/availability/catalogofferingshospitality';
const AVAILABILITY_HOSTS = new Set(['api.pp.travelport.net', 'api.travelport.net']);
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CHAIN_CODE_PATTERN = /^[A-Za-z0-9]{1,16}$/;
const PROPERTY_CODE_PATTERN = /^[A-Za-z0-9]{1,32}$/;
const MAX_RATE_CODE = 256;
const MAX_RATE_ID = 256;
const MAX_RATE_CATEGORY = 128;
const MAX_OFFERINGS = 100;
const MAX_PRODUCT_OPTIONS = 16;
const MAX_PRODUCTS = 16;
const MAX_ACTIVE_PAGINATION_AUTHORITIES = 64;
const PAGINATION_AUTHORITY_TTL_MS = 30 * 60 * 1_000;

type RecordValue = Readonly<Record<string, unknown>>;
type RateCandidateAuthority = Readonly<{
  rateCode: string | null;
  rateID: string | null;
  rateCategory: string | null;
}>;
type AvailabilitySelectionAuthority = Readonly<{
  aggregator: 'TVPT' | 'BKNG';
  chainCode: string;
  propertyCode: string;
  checkInDateLocal: string;
  checkOutDateLocal: string;
  numberOfRooms: 1;
  totalGuests: number;
  rateCandidate: RateCandidateAuthority | null;
}>;
type PaginationSelectionAuthority = Readonly<{
  authority: AvailabilitySelectionAuthority;
  expiresAtMs: number;
}>;

function invalidRequest(message = 'Travelport Availability request authority is invalid.'): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', message);
}

function invalidResponse(message = 'Travelport returned contradictory Availability selection authority.'): never {
  throw new HospitalitySupplierProviderError('INVALID_RESPONSE', message);
}

function record(value: unknown, requestSide: boolean): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (requestSide) invalidRequest();
    invalidResponse();
  }
  return value as RecordValue;
}

function exactArray(value: unknown, length: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length) invalidRequest();
  return value;
}

function boundedResponseArray(value: unknown, max: number): readonly unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) invalidResponse();
  return value;
}

function exactMachineString(value: unknown, max: number): string {
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.length > max
    || ASCII_CONTROL_PATTERN.test(value)
  ) invalidRequest();
  return value;
}

function responseMachineString(value: unknown, max: number): string {
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.length > max
    || ASCII_CONTROL_PATTERN.test(value)
  ) invalidResponse();
  return value;
}

function localDate(value: unknown): string {
  if (typeof value !== 'string' || !LOCAL_DATE_PATTERN.test(value)) invalidRequest();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalidRequest();
  return value;
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL | null {
  const raw = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function requestMethod(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function hasCanonicalEncodedPathSegment(url: URL, prefix: string): boolean {
  if (!url.pathname.startsWith(prefix)) return false;
  const suffix = url.pathname.slice(prefix.length);
  if (!suffix || suffix.includes('/')) return false;
  try {
    return encodeURIComponent(decodeURIComponent(suffix)) === suffix;
  } catch {
    return false;
  }
}

function continuationRequest(
  url: URL | null,
  method: string,
): Readonly<{ token: string; pageNumber: number }> | null {
  if (!url || !AVAILABILITY_HOSTS.has(url.hostname) || !url.pathname.startsWith(`${AVAILABILITY_PATH}/`)) {
    return null;
  }

  const entries = [...url.searchParams.entries()];
  if (
    url.protocol !== 'https:'
    || url.port !== ''
    || url.username !== ''
    || url.password !== ''
    || method !== 'GET'
    || !hasCanonicalEncodedPathSegment(url, `${AVAILABILITY_PATH}/`)
    || url.search !== `?${url.searchParams.toString()}`
    || entries.length !== 1
    || entries[0]?.[0] !== 'pageNumber'
    || !/^[2-5]$/.test(entries[0]?.[1] ?? '')
  ) {
    invalidRequest('Travelport Availability pagination request authority is invalid.');
  }

  return Object.freeze({
    token: decodeURIComponent(url.pathname.slice(`${AVAILABILITY_PATH}/`.length)),
    pageNumber: Number(entries[0]![1]),
  });
}

function availabilityRequestBody(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): string | null {
  if (typeof init?.body === 'string') return init.body;
  if (input instanceof Request && init?.body === undefined) {
    invalidRequest('Travelport Availability authority requires a materialized JSON request body.');
  }
  return null;
}

function optionalRequestMachineString(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  return exactMachineString(value, max);
}

function parseRateCandidate(
  criterion: RecordValue,
  chainCode: string,
  propertyCode: string,
): RateCandidateAuthority | null {
  if (criterion.RateCandidates === undefined || criterion.RateCandidates === null) return null;
  const rateCandidates = record(criterion.RateCandidates, true);
  if (rateCandidates['@type'] !== 'RateCandidates') invalidRequest();
  const candidates = exactArray(rateCandidates.RateCandidate, 1);
  const candidate = record(candidates[0], true);
  if (candidate['@type'] !== 'RateCandidate') invalidRequest();

  const rateCode = optionalRequestMachineString(candidate.rateCode, MAX_RATE_CODE);
  const rateID = optionalRequestMachineString(candidate.rateID, MAX_RATE_ID);
  const rateCategory = optionalRequestMachineString(candidate.rateCategory, MAX_RATE_CATEGORY);
  if (!rateCode && !rateID && !rateCategory) invalidRequest();

  if (rateCode) {
    if (candidate.chainCode !== chainCode || candidate.propertyCode !== propertyCode) invalidRequest();
  } else if (candidate.chainCode !== undefined || candidate.propertyCode !== undefined) {
    invalidRequest();
  }

  return Object.freeze({ rateCode, rateID, rateCategory });
}

function parseGuestAuthority(criterion: RecordValue): number {
  const roomStayCandidates = record(criterion.RoomStayCandidates, true);
  if (roomStayCandidates['@type'] !== 'RoomStayCandidates') invalidRequest();
  const roomCandidates = exactArray(roomStayCandidates.RoomStayCandidate, 1);
  const roomCandidate = record(roomCandidates[0], true);
  if (roomCandidate['@type'] !== 'RoomStayCandidate') invalidRequest();
  const guestCounts = record(roomCandidate.GuestCounts, true);
  if (guestCounts['@type'] !== 'GuestCounts') invalidRequest();
  if (!Array.isArray(guestCounts.GuestCount) || guestCounts.GuestCount.length < 1 || guestCounts.GuestCount.length > 9) {
    invalidRequest();
  }

  let totalGuests = 0;
  let adultEntries = 0;
  for (const [index, rawGuest] of guestCounts.GuestCount.entries()) {
    const guest = record(rawGuest, true);
    if (guest['@type'] !== 'GuestCount') invalidRequest();
    const count = guest.count;
    if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 9) invalidRequest();

    if (guest.ageQualifyingCode === '10') {
      adultEntries += 1;
      if (index !== 0 || adultEntries !== 1 || guest.age !== undefined) invalidRequest();
      totalGuests += count as number;
      continue;
    }

    if (guest.ageQualifyingCode === '8') {
      if (adultEntries !== 1 || count !== 1 || !Number.isInteger(guest.age) || (guest.age as number) < 0 || (guest.age as number) > 17) {
        invalidRequest();
      }
      totalGuests += 1;
      continue;
    }

    invalidRequest();
  }

  if (adultEntries !== 1 || totalGuests < 1 || totalGuests > 9) invalidRequest();
  return totalGuests;
}

function parseAvailabilitySelection(bodyText: string): AvailabilitySelectionAuthority {
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    invalidRequest('Travelport Availability request body is not valid JSON.');
  }

  const root = record(payload, true);
  const query = record(root.CatalogOfferingsQueryRequest, true);
  const requests = exactArray(query.CatalogOfferingsRequest, 1);
  const request = record(requests[0], true);
  if (request['@type'] !== 'CatalogOfferingsRequestHospitality' || request.verboseResponseInd !== true) invalidRequest();

  const dates = record(request.StayDates, true);
  const checkInDateLocal = localDate(dates.start);
  const checkOutDateLocal = localDate(dates.end);
  if (checkOutDateLocal <= checkInDateLocal) invalidRequest();

  const criterion = record(request.HotelSearchCriterion, true);
  if (criterion['@type'] !== 'HotelSearchCriterion' || criterion.numberOfRooms !== 1) invalidRequest();
  const aggregators = exactArray(criterion.AggregatorList, 1);
  const aggregator = aggregators[0];
  if (aggregator !== 'TVPT' && aggregator !== 'BKNG') invalidRequest();

  const propertyRequests = exactArray(criterion.PropertyRequest, 1);
  const propertyRequest = record(propertyRequests[0], true);
  if (propertyRequest['@type'] !== 'PropertyRequest') invalidRequest();
  const propertyKey = record(propertyRequest.PropertyKey, true);
  if (propertyKey['@type'] !== 'PropertyKey') invalidRequest();
  const chainCode = exactMachineString(propertyKey.chainCode, 16);
  const propertyCode = exactMachineString(propertyKey.propertyCode, 32);
  if (!CHAIN_CODE_PATTERN.test(chainCode) || !PROPERTY_CODE_PATTERN.test(propertyCode)) invalidRequest();

  const totalGuests = parseGuestAuthority(criterion);
  const rateCandidate = parseRateCandidate(criterion, chainCode, propertyCode);

  return Object.freeze({
    aggregator,
    chainCode,
    propertyCode,
    checkInDateLocal,
    checkOutDateLocal,
    numberOfRooms: 1,
    totalGuests,
    rateCandidate,
  });
}

function presentResponseRecord(value: unknown): RecordValue | null {
  if (value === undefined || value === null) return null;
  return record(value, false);
}

function assertOptionalResponseSelection(
  product: RecordValue,
  authority: AvailabilitySelectionAuthority,
): void {
  if (product.guests !== undefined && product.guests !== null) {
    if (!Number.isSafeInteger(product.guests) || product.guests !== authority.totalGuests) invalidResponse();
  }
  if (product.Quantity !== undefined && product.Quantity !== null) {
    if (!Number.isSafeInteger(product.Quantity) || (product.Quantity as number) < authority.numberOfRooms) invalidResponse();
  }

  const propertyKey = presentResponseRecord(product.PropertyKey);
  if (propertyKey) {
    if (propertyKey.chainCode !== authority.chainCode || propertyKey.propertyCode !== authority.propertyCode) invalidResponse();
  }

  const dateRange = presentResponseRecord(product.DateRange);
  if (dateRange) {
    if (dateRange.start !== authority.checkInDateLocal || dateRange.end !== authority.checkOutDateLocal) invalidResponse();
  }
}

function assertRateCandidateResponse(
  offering: RecordValue,
  authority: AvailabilitySelectionAuthority,
): void {
  const expected = authority.rateCandidate;
  if (!expected) return;
  const terms = presentResponseRecord(offering.TermsAndConditions);
  const rateInfoContainer = terms ? presentResponseRecord(terms.ProductRateCodeInfo) : null;
  const rateInfo = rateInfoContainer ? presentResponseRecord(rateInfoContainer.RateCodeInfo) : null;
  if (!rateInfo) return;

  const observedRateCode = rateInfo.value === undefined || rateInfo.value === null
    ? null
    : responseMachineString(rateInfo.value, MAX_RATE_CODE);
  const observedRateID = rateInfo.rateID === undefined || rateInfo.rateID === null
    ? null
    : responseMachineString(rateInfo.rateID, MAX_RATE_ID);
  const observedRateCategory = rateInfo.rateCategory === undefined || rateInfo.rateCategory === null
    ? null
    : responseMachineString(rateInfo.rateCategory, MAX_RATE_CATEGORY);

  if (
    (expected.rateCode && observedRateCode && observedRateCode !== expected.rateCode)
    || (expected.rateID && observedRateID && observedRateID !== expected.rateID)
    || (expected.rateCategory && observedRateCategory && observedRateCategory !== expected.rateCategory)
  ) invalidResponse();
}

function assertAvailabilityResponseSelection(
  payload: unknown,
  authority: AvailabilitySelectionAuthority,
): void {
  const root = record(payload, false);
  const response = record(root.CatalogOfferingsHospitalityResponse, false);
  const catalog = record(response.CatalogOfferings, false);

  for (const rawOffering of boundedResponseArray(catalog.CatalogOffering, MAX_OFFERINGS)) {
    const offering = record(rawOffering, false);
    const identifier = record(offering.Identifier, false);
    if (identifier.authority !== authority.aggregator) invalidResponse();
    responseMachineString(identifier.value, 4_096);
    assertRateCandidateResponse(offering, authority);

    for (const rawOption of boundedResponseArray(offering.ProductOptions, MAX_PRODUCT_OPTIONS)) {
      const option = record(rawOption, false);
      for (const rawProduct of boundedResponseArray(option.Product, MAX_PRODUCTS)) {
        assertOptionalResponseSelection(record(rawProduct, false), authority);
      }
    }
  }
}

function availabilityResponseCatalog(payload: unknown): RecordValue {
  const root = record(payload, false);
  const response = record(root.CatalogOfferingsHospitalityResponse, false);
  return record(response.CatalogOfferings, false);
}

function availabilityResponsePageCount(payload: unknown): number {
  const pages = availabilityResponseCatalog(payload).numberOfPages;
  if (!Number.isSafeInteger(pages) || (pages as number) < 1 || (pages as number) > 5) invalidResponse();
  return pages as number;
}

function paginationResponseAuthority(payload: unknown): Readonly<{ token: string; pages: number }> | null {
  const catalog = availabilityResponseCatalog(payload);
  const pages = availabilityResponsePageCount(payload);
  if (pages <= 1) return null;
  const identifier = presentResponseRecord(catalog.Identifier);
  if (!identifier) invalidResponse('Travelport Availability pagination identifier is missing.');
  return Object.freeze({ token: responseMachineString(identifier.value, 4_096), pages });
}

export function createTravelportStaysAvailabilitySelectionAuthorityFetch(
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const paginationAuthorities = new Map<string, PaginationSelectionAuthority>();

  function prunePaginationAuthorities(nowMs: number): void {
    for (const [token, stored] of paginationAuthorities) {
      if (stored.expiresAtMs <= nowMs) paginationAuthorities.delete(token);
    }
  }

  return (async (input, init) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const targetsInitialAvailability = !!url
      && AVAILABILITY_HOSTS.has(url.hostname)
      && url.pathname === AVAILABILITY_PATH;

    const continuation = continuationRequest(url, method);
    if (continuation) {
      const nowMs = Date.now();
      prunePaginationAuthorities(nowMs);
      const stored = paginationAuthorities.get(continuation.token);
      if (!stored) invalidRequest('Travelport Availability pagination token is not bound to an active selection authority.');

      const response = await fetchImpl(input, init);
      if (!response.ok) return response;
      const payload = await response.clone().json().catch(() => null);
      if (payload === null) invalidResponse('Travelport Availability response is not valid JSON.');
      assertAvailabilityResponseSelection(payload, stored.authority);
      const pages = availabilityResponsePageCount(payload);
      if (continuation.pageNumber >= pages) paginationAuthorities.delete(continuation.token);
      return response;
    }

    if (!targetsInitialAvailability) return fetchImpl(input, init);
    if (
      url.protocol !== 'https:'
      || url.port !== ''
      || url.username !== ''
      || url.password !== ''
      || url.search !== ''
      || method !== 'POST'
    ) {
      invalidRequest('Travelport Availability endpoint authority is invalid.');
    }

    const bodyText = availabilityRequestBody(input, init);
    if (bodyText === null) invalidRequest('Travelport Availability authority requires a JSON request body.');
    const authority = parseAvailabilitySelection(bodyText);
    const response = await fetchImpl(input, init);
    if (!response.ok) return response;

    const payload = await response.clone().json().catch(() => null);
    if (payload === null) invalidResponse('Travelport Availability response is not valid JSON.');
    assertAvailabilityResponseSelection(payload, authority);

    const pagination = paginationResponseAuthority(payload);
    if (pagination) {
      const nowMs = Date.now();
      prunePaginationAuthorities(nowMs);
      if (!paginationAuthorities.has(pagination.token) && paginationAuthorities.size >= MAX_ACTIVE_PAGINATION_AUTHORITIES) {
        invalidResponse('Travelport Availability pagination authority capacity was exceeded.');
      }
      paginationAuthorities.set(pagination.token, Object.freeze({
        authority,
        expiresAtMs: nowMs + PAGINATION_AUTHORITY_TTL_MS,
      }));
    }
    return response;
  }) as typeof fetch;
}
