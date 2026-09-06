import { createHash, randomUUID } from 'node:crypto';

import { normalizeCurrency, parseMoneyMajorToMinor } from '../pricing/money.ts';
import type { HospitalitySupplierBookingTermsProvider } from './hospitality-supplier-booking-terms.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type {
  HospitalitySupplierReservationAuthorityInput,
  HospitalitySupplierReservationAuthorityProvider,
  HospitalitySupplierReservationAuthorityResult,
} from './hospitality-supplier-reservation-authority.ts';
import { requestTravelportStaysAccessToken, type TravelportStaysCredentials } from './travelport-stays-provider.ts';

const ENDPOINTS = Object.freeze({
  'pre-production': Object.freeze({ v11: 'https://api.pp.travelport.net/11/hotel/', v12: 'https://api.pp.travelport.net/12/hotel/' }),
  production: Object.freeze({ v11: 'https://api.travelport.net/11/hotel/', v12: 'https://api.travelport.net/12/hotel/' }),
});
const MAX_REFERENCE = 4_096;
const MAX_PAGE_COUNT = 5;
const MAX_PAGE_SIZE = 100;
const MAX_TOTAL_OFFERS = MAX_PAGE_COUNT * MAX_PAGE_SIZE;
const DEFAULT_TIMEOUT_MS = 15_000;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const tokenCache = new Map<string, Readonly<{ token: string; expiresAtMs: number }>>();
const tokenRequests = new Map<string, Promise<string>>();

type RecordValue = Record<string, unknown>;
type PropertyIdentity = Readonly<{ chainCode: string; propertyCode: string; authority: 'TVPT' }>;
type OfferIdentity = Readonly<{ property: PropertyIdentity; rateValue: string; rateAuthority: 'TVPT' | 'BKNG' }>;
type RateCandidate = Readonly<{ rateCode?: string; rateID?: string; rateCategory?: string; chainCode: string; propertyCode: string }>;
type SelectedRate = Readonly<{ bookingCode: string; rateCandidate: RateCandidate | null }>;
type AvailabilityMatch = Readonly<{
  providerSubmissionReference: string;
  bookingCode: string;
  rateCode: string | null;
  rateID: string | null;
  rateCategory: string | null;
}>;

export type TravelportStaysReservationAuthorityResult = HospitalitySupplierReservationAuthorityResult & Readonly<{
  providerSubmissionReference: string | null;
}>;

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  return value as RecordValue;
}

function array(value: unknown, max: number) {
  if (!Array.isArray(value) || value.length > max) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  return value;
}

function providerText(value: unknown, max = 512) {
  if (typeof value !== 'string') throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\r\n]/.test(normalized)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  return normalized;
}

function optionalProviderText(value: unknown, max = 512): string | null {
  if (value === undefined || value === null || value === '') return null;
  return providerText(value, max);
}

function decodeReference(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > MAX_REFERENCE || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier reference is invalid.');
  }
  try {
    return record(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch (error) {
    if (error instanceof HospitalitySupplierProviderError) throw error;
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier reference is invalid.');
  }
}

function propertyIdentity(value: unknown): PropertyIdentity {
  const decoded = decodeReference(value);
  const chainCode = typeof decoded.chainCode === 'string' ? decoded.chainCode.trim() : '';
  const propertyCode = typeof decoded.propertyCode === 'string' ? decoded.propertyCode.trim() : '';
  if (decoded.authority !== 'TVPT' || !/^[A-Za-z0-9]{1,16}$/.test(chainCode) || !/^[A-Za-z0-9]{1,32}$/.test(propertyCode)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier property reference is invalid.');
  }
  return Object.freeze({ chainCode, propertyCode, authority: 'TVPT' });
}

function offerIdentity(value: unknown): OfferIdentity {
  const decoded = decodeReference(value);
  const property = propertyIdentity(Buffer.from(JSON.stringify({
    chainCode: decoded.chainCode,
    propertyCode: decoded.propertyCode,
    authority: decoded.propertyAuthority,
  }), 'utf8').toString('base64url'));
  const rateValue = typeof decoded.rateValue === 'string' ? decoded.rateValue.trim() : '';
  if ((decoded.rateAuthority !== 'TVPT' && decoded.rateAuthority !== 'BKNG') || !rateValue || rateValue.length > MAX_REFERENCE || /[\r\n]/.test(rateValue)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier offer reference is invalid.');
  }
  return Object.freeze({ property, rateValue, rateAuthority: decoded.rateAuthority });
}

function localDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HospitalitySupplierProviderError('INVALID_REQUEST', `${label} is invalid.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new HospitalitySupplierProviderError('INVALID_REQUEST', `${label} is invalid.`);
  return value;
}

function normalizeInput(input: HospitalitySupplierReservationAuthorityInput) {
  const property = propertyIdentity(input.supplierPropertyReference);
  const offer = offerIdentity(input.supplierOfferReference);
  if (property.chainCode !== offer.property.chainCode || property.propertyCode !== offer.property.propertyCode) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier offer does not belong to the selected property.');
  }
  const checkInDateLocal = localDate(input.checkInDateLocal, 'Check-in date');
  const checkOutDateLocal = localDate(input.checkOutDateLocal, 'Check-out date');
  if (checkOutDateLocal <= checkInDateLocal || input.rooms !== 1) throw new HospitalitySupplierProviderError('INVALID_REQUEST');
  const childAges = input.childAges ? [...input.childAges] : [];
  if (!Number.isInteger(input.adults) || input.adults < 1 || childAges.length > 8 || childAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17) || input.adults + childAges.length > 9) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport reservation authority supports one room and one to nine guests.');
  }
  let currency: string;
  try { currency = normalizeCurrency(input.currency); } catch { throw new HospitalitySupplierProviderError('INVALID_REQUEST'); }
  if (typeof input.expectedTotalMinor !== 'bigint' || input.expectedTotalMinor < 0n || !FINGERPRINT.test(input.expectedOfferFingerprint) || !FINGERPRINT.test(input.expectedTermsFingerprint)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST');
  }
  return Object.freeze({ property, offer, checkInDateLocal, checkOutDateLocal, adults: input.adults, childAges: Object.freeze(childAges), currency, expectedTotalMinor: input.expectedTotalMinor, expectedOfferFingerprint: input.expectedOfferFingerprint, expectedTermsFingerprint: input.expectedTermsFingerprint });
}

function moneyMinor(value: unknown, currency: string) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!text) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  try { return parseMoneyMajorToMinor(text, currency).amountMinor; } catch { throw new HospitalitySupplierProviderError('INVALID_RESPONSE'); }
}

function selectedRate(value: unknown, input: ReturnType<typeof normalizeInput>): SelectedRate {
  const hotelsResponse = record(record(value).hotelsResponse);
  const properties = array(hotelsResponse.propertyItems, 1);
  if (properties.length !== 1) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const property = record(properties[0]);
  if (property.chainCode !== input.property.chainCode || property.propertyCode !== input.property.propertyCode) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const matches: RecordValue[] = [];
  for (const room of array(property.roomTypes, 128)) {
    for (const rateValue of array(record(room).rates, 256)) {
      const rate = record(rateValue);
      const key = record(rate.rateKey);
      if (key.value === input.offer.rateValue && key.authority === input.offer.rateAuthority) matches.push(rate);
    }
  }
  if (matches.length !== 1) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  const rate = matches[0]!;
  const price = record(rate.price);
  let responseCurrency: string;
  if (typeof price.currencyCode !== 'string') throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  try { responseCurrency = normalizeCurrency(price.currencyCode); } catch { throw new HospitalitySupplierProviderError('INVALID_RESPONSE'); }
  if (responseCurrency !== input.currency || moneyMinor(record(price.totalPrice).amount, responseCurrency) !== input.expectedTotalMinor) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport selected offer changed while reservation authority was being prepared.');
  }
  let rateCandidate: RateCandidate | null = null;
  if (rate.rateCodeInfo !== undefined && rate.rateCodeInfo !== null) {
    const info = record(rate.rateCodeInfo);
    const rateCode = optionalProviderText(info.rateCode, 256);
    const rateID = optionalProviderText(info.ratePlanID, 256);
    const rateCategory = optionalProviderText(info.rateCategory, 128);
    if (rateCode || rateID || rateCategory) rateCandidate = Object.freeze({ ...(rateCode ? { rateCode } : {}), ...(rateID ? { rateID } : {}), ...(rateCategory ? { rateCategory } : {}), chainCode: input.property.chainCode, propertyCode: input.property.propertyCode });
  }
  return Object.freeze({ bookingCode: providerText(rate.bookingCode), rateCandidate });
}

function availabilityPage(value: unknown, input: ReturnType<typeof normalizeInput>, selected: SelectedRate, requireIdentifier: boolean) {
  const catalog = record(record(record(value).CatalogOfferingsHospitalityResponse).CatalogOfferings);
  const total = catalog.totalCatalogOffering;
  const perPage = catalog.catalogOfferingPerPage;
  const pages = catalog.numberOfPages;
  if (!Number.isInteger(total) || !Number.isInteger(perPage) || !Number.isInteger(pages) || (total as number) < 0 || (total as number) > MAX_TOTAL_OFFERS || (perPage as number) < 0 || (perPage as number) > MAX_PAGE_SIZE || (pages as number) < 1 || (pages as number) > MAX_PAGE_COUNT) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  const offerings = catalog.CatalogOffering === undefined ? [] : array(catalog.CatalogOffering, MAX_PAGE_SIZE);
  if (offerings.length > (perPage as number)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  let paginationIdentifier: string | null = null;
  if ((pages as number) > 1 && requireIdentifier) paginationIdentifier = providerText(record(catalog.Identifier).value, MAX_REFERENCE);

  const identifiers: string[] = [];
  const matches: AvailabilityMatch[] = [];
  for (const rawOffering of offerings) {
    const offering = record(rawOffering);
    const identifier = record(offering.Identifier);
    const identifierValue = providerText(identifier.value, MAX_REFERENCE);
    if ((identifier.authority !== 'TVPT' && identifier.authority !== 'BKNG') || (offering.id !== undefined && offering.id !== identifierValue)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    identifiers.push(identifierValue);
    const terms = offering.TermsAndConditions === undefined || offering.TermsAndConditions === null ? null : record(offering.TermsAndConditions);
    const rateInfoContainer = terms?.ProductRateCodeInfo === undefined || terms?.ProductRateCodeInfo === null ? null : record(terms.ProductRateCodeInfo);
    const rateInfo = rateInfoContainer?.RateCodeInfo === undefined || rateInfoContainer?.RateCodeInfo === null ? null : record(rateInfoContainer.RateCodeInfo);
    const observedRate = Object.freeze({ rateCode: optionalProviderText(rateInfo?.value, 256), rateID: optionalProviderText(rateInfo?.rateID, 256), rateCategory: optionalProviderText(rateInfo?.rateCategory, 128) });
    const expected = selected.rateCandidate;
    const rateConflicts = !!expected && ((observedRate.rateCode !== null && expected.rateCode !== undefined && observedRate.rateCode !== expected.rateCode) || (observedRate.rateID !== null && expected.rateID !== undefined && observedRate.rateID !== expected.rateID) || (observedRate.rateCategory !== null && expected.rateCategory !== undefined && observedRate.rateCategory !== expected.rateCategory));
    if (identifier.authority !== input.offer.rateAuthority || rateConflicts) continue;

    for (const optionValue of array(offering.ProductOptions, 16)) {
      for (const productValue of array(record(optionValue).Product, 16)) {
        const product = record(productValue);
        if (product.bookingCode !== selected.bookingCode) continue;
        const property = record(product.PropertyKey);
        const dates = record(product.DateRange);
        if (property.chainCode === input.property.chainCode && property.propertyCode === input.property.propertyCode && dates.start === input.checkInDateLocal && dates.end === input.checkOutDateLocal) {
          matches.push(Object.freeze({ providerSubmissionReference: identifierValue, bookingCode: selected.bookingCode, ...observedRate }));
        }
      }
    }
  }
  if (new Set(identifiers).size !== identifiers.length || matches.length > 1) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  return Object.freeze({ total: total as number, pages: pages as number, paginationIdentifier, identifiers: Object.freeze(identifiers), matches: Object.freeze(matches) });
}

function fingerprint(input: ReturnType<typeof normalizeInput>, selectedRateAuthority: SelectedRate, match: AvailabilityMatch) {
  const fields = [
    'travelport-stays', input.property.chainCode, input.property.propertyCode, input.offer.rateAuthority, input.offer.rateValue,
    selectedRateAuthority.bookingCode, selectedRateAuthority.rateCandidate?.rateCode ?? '', selectedRateAuthority.rateCandidate?.rateID ?? '', selectedRateAuthority.rateCandidate?.rateCategory ?? '',
    match.rateCode ?? '', match.rateID ?? '', match.rateCategory ?? '', input.checkInDateLocal, input.checkOutDateLocal, '1', String(input.adults), input.childAges.join(','),
    input.currency, input.expectedTotalMinor.toString(), input.expectedOfferFingerprint, input.expectedTermsFingerprint,
  ];
  return createHash('sha256').update(fields.join('\u001f'), 'utf8').digest('hex');
}

function timeoutMs(value: number | undefined) {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000) throw new HospitalitySupplierProviderError('INVALID_REQUEST');
  return timeout;
}

function failure(status: number) {
  if (status === 401 || status === 403) return new HospitalitySupplierProviderError('AUTHENTICATION_FAILED');
  if (status === 429) return new HospitalitySupplierProviderError('RATE_LIMITED');
  if (status >= 500) return new HospitalitySupplierProviderError('PROVIDER_UNAVAILABLE');
  return new HospitalitySupplierProviderError('INVALID_RESPONSE');
}

export class TravelportStaysReservationAuthorityProvider implements HospitalitySupplierReservationAuthorityProvider {
  readonly #credentials: TravelportStaysCredentials;
  readonly #cacheKey: string;
  readonly #bookingTermsProvider: HospitalitySupplierBookingTermsProvider;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #now: () => Date;

  constructor(input: { credentials: TravelportStaysCredentials; cacheKey: string; bookingTermsProvider: HospitalitySupplierBookingTermsProvider; fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => Date }) {
    if (!input.cacheKey || input.cacheKey.length > 512 || /[\r\n]/.test(input.cacheKey)) throw new HospitalitySupplierProviderError('INVALID_REQUEST');
    this.#credentials = input.credentials;
    this.#cacheKey = input.cacheKey;
    this.#bookingTermsProvider = input.bookingTermsProvider;
    this.#fetch = input.fetchImpl ?? fetch;
    this.#timeoutMs = timeoutMs(input.timeoutMs);
    this.#now = input.now ?? (() => new Date());
  }

  async #token() {
    const nowMs = this.#now().getTime();
    const cached = tokenCache.get(this.#cacheKey);
    if (cached && cached.expiresAtMs > nowMs) return cached.token;
    const pending = tokenRequests.get(this.#cacheKey);
    if (pending) return pending;
    const request = requestTravelportStaysAccessToken({ credentials: this.#credentials, fetchImpl: this.#fetch, timeoutMs: this.#timeoutMs, nowMs })
      .then((token) => { tokenCache.set(this.#cacheKey, Object.freeze({ token: token.accessToken, expiresAtMs: token.expiresAtMs })); return token.accessToken; })
      .finally(() => tokenRequests.delete(this.#cacheKey));
    tokenRequests.set(this.#cacheKey, request);
    return request;
  }

  async #request(input: { url: string; method: 'GET' | 'POST'; body?: unknown; freshPricing?: boolean }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(input.url, {
        method: input.method,
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'Accept-Encoding': 'gzip, deflate', 'Cache-Control': 'no-cache', Accept: 'application/json', 'Content-Type': 'application/json',
          Authorization: `Bearer ${await this.#token()}`, XAUTH_TRAVELPORT_ACCESSGROUP: this.#credentials.accessGroup, E2ETrackingID: `sf-${randomUUID()}`,
          username: this.#credentials.username, password: this.#credentials.password, client_id: this.#credentials.clientId, client_secret: this.#credentials.clientSecret,
          ...(input.freshPricing ? { 'TVP-Cache-Control': 'no-cache' } : {}),
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      });
    } catch {
      throw new HospitalitySupplierProviderError(controller.signal.aborted ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) tokenCache.delete(this.#cacheKey);
      throw failure(response.status);
    }
    return response.json().catch(() => null);
  }

  async verifyReservationAuthority(input: HospitalitySupplierReservationAuthorityInput): Promise<TravelportStaysReservationAuthorityResult> {
    const normalized = normalizeInput(input);
    const reviewed = await this.#bookingTermsProvider.retrieveBookingTerms(input);
    if (reviewed.status !== 'READY') {
      return Object.freeze({ status: reviewed.status, offer: reviewed.offer, bookingTerms: null, authorityFingerprint: null, providerSubmissionReference: null, observedAt: reviewed.observedAt, revalidationRequired: true });
    }
    if (!reviewed.offer || !reviewed.bookingTerms) {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Supplier booking review returned incomplete reservation authority evidence.');
    }
    if (reviewed.offer.offerFingerprint !== normalized.expectedOfferFingerprint || reviewed.bookingTerms.supplierPropertyReference !== input.supplierPropertyReference || reviewed.bookingTerms.supplierOfferReference !== input.supplierOfferReference || reviewed.bookingTerms.price.currency !== normalized.currency || reviewed.bookingTerms.price.totalMinor !== normalized.expectedTotalMinor) {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Supplier booking review returned inconsistent reservation authority evidence.');
    }
    if (reviewed.bookingTerms.termsFingerprint !== normalized.expectedTermsFingerprint) {
      return Object.freeze({ status: 'TERMS_CHANGED', offer: reviewed.offer, bookingTerms: reviewed.bookingTerms, authorityFingerprint: null, providerSubmissionReference: null, observedAt: reviewed.observedAt, revalidationRequired: true });
    }
    if (!reviewed.bookingTerms.completeForReservationReview) {
      return Object.freeze({ status: 'TERMS_INCOMPLETE', offer: reviewed.offer, bookingTerms: reviewed.bookingTerms, authorityFingerprint: null, providerSubmissionReference: null, observedAt: reviewed.observedAt, revalidationRequired: true });
    }

    const endpoints = ENDPOINTS[this.#credentials.environment];
    const searchPayload = await this.#request({
      url: `${endpoints.v12}search/searchcomplete`, method: 'POST', freshPricing: true,
      body: { requestedCurrency: normalized.currency, stayDetails: { checkInDateLocal: normalized.checkInDateLocal, checkOutDateLocal: normalized.checkOutDateLocal, rooms: 1, guests: { adults: normalized.adults, ...(normalized.childAges.length ? { children: normalized.childAges.map((age) => ({ age })) } : {}) } }, propertyFilter: { propertyKeys: [{ ...normalized.property }], returnOnlyAvailableProperties: true }, returnCompleteNightlyRateBreakdown: true },
    });
    const selected = selectedRate(searchPayload, normalized);
    const rate = selected.rateCandidate;
    const guestCounts = [{ '@type': 'GuestCount', count: normalized.adults, ageQualifyingCode: '10' }, ...normalized.childAges.map((age) => ({ '@type': 'GuestCount', count: 1, ageQualifyingCode: '8', age }))];
    const availabilityPayload = await this.#request({
      url: `${endpoints.v11}availability/catalogofferingshospitality`, method: 'POST',
      body: { CatalogOfferingsQueryRequest: { CatalogOfferingsRequest: [{ '@type': 'CatalogOfferingsRequestHospitality', verboseResponseInd: true, StayDates: { start: normalized.checkInDateLocal, end: normalized.checkOutDateLocal }, HotelSearchCriterion: { '@type': 'HotelSearchCriterion', numberOfRooms: 1, AggregatorList: [normalized.offer.rateAuthority], ...(rate && (rate.rateCode || rate.rateID || rate.rateCategory) ? { RateCandidates: { '@type': 'RateCandidates', RateCandidate: [{ '@type': 'RateCandidate', ...(rate.rateCode ? { rateCode: rate.rateCode, chainCode: rate.chainCode, propertyCode: rate.propertyCode } : {}), ...(rate.rateID ? { rateID: rate.rateID } : {}), ...(rate.rateCategory ? { rateCategory: rate.rateCategory } : {}) }] } } : {}), PropertyRequest: [{ '@type': 'PropertyRequest', PropertyKey: { '@type': 'PropertyKey', chainCode: normalized.property.chainCode, propertyCode: normalized.property.propertyCode } }], RoomStayCandidates: { '@type': 'RoomStayCandidates', RoomStayCandidate: [{ '@type': 'RoomStayCandidate', GuestCounts: { '@type': 'GuestCounts', GuestCount: guestCounts } }] } } }] } },
    });

    const first = availabilityPage(availabilityPayload, normalized, selected, true);
    const identifiers = new Set(first.identifiers);
    const matches = [...first.matches];
    for (let pageNumber = 2; pageNumber <= first.pages; pageNumber += 1) {
      if (!first.paginationIdentifier) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      const page = availabilityPage(await this.#request({ url: `${endpoints.v11}availability/catalogofferingshospitality/${encodeURIComponent(first.paginationIdentifier)}?pageNumber=${pageNumber}`, method: 'GET' }), normalized, selected, false);
      if (page.pages !== first.pages || page.total !== first.total) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
      for (const identifier of page.identifiers) { if (identifiers.has(identifier)) throw new HospitalitySupplierProviderError('INVALID_RESPONSE'); identifiers.add(identifier); }
      matches.push(...page.matches);
      if (matches.length > 1) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    }
    if (identifiers.size !== first.total) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    if (matches.length === 0) return Object.freeze({ status: 'UNAVAILABLE', offer: reviewed.offer, bookingTerms: reviewed.bookingTerms, authorityFingerprint: null, providerSubmissionReference: null, observedAt: this.#now().toISOString(), revalidationRequired: true });
    if (matches.length !== 1) throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
    return Object.freeze({ status: 'READY', offer: reviewed.offer, bookingTerms: reviewed.bookingTerms, authorityFingerprint: fingerprint(normalized, selected, matches[0]!), providerSubmissionReference: matches[0]!.providerSubmissionReference, observedAt: this.#now().toISOString(), revalidationRequired: true });
  }
}
