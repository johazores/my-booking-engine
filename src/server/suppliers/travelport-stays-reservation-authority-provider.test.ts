import assert from 'node:assert/strict';
import test from 'node:test';

import type { HospitalitySupplierBookingTerms, HospitalitySupplierBookingTermsProvider } from './hospitality-supplier-booking-terms.ts';
import { HospitalitySupplierProviderError, type HospitalitySupplierOffer } from './hospitality-supplier-provider.ts';
import { TravelportStaysReservationAuthorityProvider } from './travelport-stays-reservation-authority-provider.ts';
import { normalizeTravelportStaysConfiguration } from './travelport-stays-provider.ts';

const propertyReference = Buffer.from(JSON.stringify({ chainCode: 'HI', propertyCode: 'ABC12', authority: 'TVPT' })).toString('base64url');
const offerReference = Buffer.from(JSON.stringify({ chainCode: 'HI', propertyCode: 'ABC12', propertyAuthority: 'TVPT', rateValue: 'rate-key-1', rateAuthority: 'TVPT' })).toString('base64url');
const offerFingerprint = 'a'.repeat(64);
const termsFingerprint = 'b'.repeat(64);
const selection = Object.freeze({ supplierPropertyReference: propertyReference, supplierOfferReference: offerReference, checkInDateLocal: '2026-10-10', checkOutDateLocal: '2026-10-12', rooms: 1, adults: 1, childAges: [8], currency: 'USD', expectedTotalMinor: 14765n, expectedOfferFingerprint: offerFingerprint, expectedTermsFingerprint: termsFingerprint });
const configuration = normalizeTravelportStaysConfiguration({ environment: 'pre-production', username: 'hotel-user', password: 'hotel-password', clientId: 'hotel-client', clientSecret: 'hotel-secret', accessGroup: 'hotel-access' });

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function reviewedOffer() {
  return { supplierPropertyReference: propertyReference, supplierOfferReference: offerReference, offerFingerprint } as unknown as HospitalitySupplierOffer;
}

function reviewedTerms(fingerprint = termsFingerprint, complete = true) {
  return { supplierPropertyReference: propertyReference, supplierOfferReference: offerReference, observedAt: '2026-09-06T02:00:00.000Z', price: { currency: 'USD', baseMinor: 12513n, taxMinor: 2252n, feeMinor: 0n, totalMinor: 14765n }, paymentTiming: 'PREPAY', guaranteeTypes: ['GUARANTEE_REQUIRED'], customerLoyaltyRequiredAtReservation: false, qualificationRequiredAtCheckIn: false, acceptedPaymentCardCodes: ['VI'], cancellationRules: [], deposits: [], checkInTimeLocal: null, checkOutTimeLocal: null, textRules: [], termsFingerprint: fingerprint, completeForReservationReview: complete, revalidationRequired: true } as unknown as HospitalitySupplierBookingTerms;
}

function termsProvider(input: { fingerprint?: string; complete?: boolean } = {}): HospitalitySupplierBookingTermsProvider {
  return { async retrieveBookingTerms() { return { status: 'READY', offer: reviewedOffer(), bookingTerms: reviewedTerms(input.fingerprint, input.complete), observedAt: '2026-09-06T02:00:00.000Z' }; } };
}

function searchComplete() {
  return { hotelsResponse: { propertyItems: [{ chainCode: 'HI', propertyCode: 'ABC12', roomTypes: [{ rates: [{ rateKey: { value: 'rate-key-1', authority: 'TVPT' }, bookingCode: 'KHATHR', rateCodeInfo: { rateCode: 'THR', ratePlanID: 'THORPREFERRED', rateCategory: 'MultLevel/Negotiated/Secure' }, price: { currencyCode: 'USD', totalPrice: { amount: 147.65 } } }] }] }] } };
}

function offering(id: string, bookingCode: string, includeRate = true) {
  return { '@type': 'CatalogOfferingHospitality', id, Identifier: { value: id, authority: 'TVPT' }, ProductOptions: [{ '@type': 'ProductOptions', Product: [{ '@type': 'ProductHospitalityOffer', bookingCode, PropertyKey: { '@type': 'PropertyKey', chainCode: 'HI', propertyCode: 'ABC12' }, DateRange: { start: '2026-10-10', end: '2026-10-12' } }] }], ...(includeRate ? { TermsAndConditions: { ProductRateCodeInfo: { RateCodeInfo: { value: 'THR', rateID: 'THORPREFERRED', rateCategory: 'MultLevel/Negotiated/Secure' } } } } : {}) };
}

function page(offers: unknown[], total: number, pages = 1, identifier?: string) {
  return { CatalogOfferingsHospitalityResponse: { CatalogOfferings: { totalCatalogOffering: total, catalogOfferingPerPage: offers.length, numberOfPages: pages, ...(identifier ? { Identifier: { value: identifier } } : {}), CatalogOffering: offers } } };
}

function provider(fetchImpl: typeof fetch, bookingTermsProvider = termsProvider(), cacheKey = `authority-${Math.random()}`) {
  return new TravelportStaysReservationAuthorityProvider({ credentials: configuration.credentials, cacheKey, bookingTermsProvider, fetchImpl, now: () => new Date('2026-09-06T02:00:10.000Z') });
}

function baseFetch(availability: (url: string) => Response) {
  return (async (url) => {
    const value = String(url);
    if (value.includes('/oauth/token')) return response({ access_token: 'authority-token', expires_in: 3600 });
    if (value.endsWith('/12/hotel/search/searchcomplete')) return response(searchComplete());
    return availability(value);
  }) as typeof fetch;
}

test('maps the selected SearchComplete rate through complete bounded Availability results', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url, init) => {
    const value = String(url); requests.push({ url: value, init });
    if (value.includes('/oauth/token')) return response({ access_token: 'authority-token', expires_in: 3600 });
    if (value.endsWith('/12/hotel/search/searchcomplete')) return response(searchComplete());
    if (value.includes('?pageNumber=2')) return response(page([offering('match', 'KHATHR')], 2, 2));
    return response(page([offering('other', 'OTHER')], 2, 2, 'availability-token'));
  }) as typeof fetch;
  const result = await provider(fetchImpl).verifyReservationAuthority(selection);
  assert.equal(result.status, 'READY');
  assert.match(result.authorityFingerprint ?? '', /^[0-9a-f]{64}$/);
  const availability = requests.find((item) => item.url.endsWith('/11/hotel/availability/catalogofferingshospitality'))!;
  const body = JSON.parse(String(availability.init?.body));
  const request = body.CatalogOfferingsQueryRequest.CatalogOfferingsRequest[0];
  assert.equal(request.verboseResponseInd, true);
  assert.equal(request.requestedCurrency, undefined);
  assert.equal(request.HotelSearchCriterion.RateCandidates.RateCandidate[0].rateCode, 'THR');
  assert.equal(requests.find((item) => item.url.includes('?pageNumber=2'))?.init?.method, 'GET');
  assert.equal(requests.some((item) => item.url.includes('book/reservations')), false);
});

test('accepts an exact filtered booking-code match when Availability omits rate-code echo', async () => {
  const result = await provider(baseFetch(() => response(page([offering('match-no-rate', 'KHATHR', false)], 1)))).verifyReservationAuthority(selection);
  assert.equal(result.status, 'READY');
});

test('changed or incomplete Rules evidence stops before Travelport calls', async () => {
  for (const [terms, expected] of [[termsProvider({ fingerprint: 'c'.repeat(64) }), 'TERMS_CHANGED'], [termsProvider({ complete: false }), 'TERMS_INCOMPLETE']] as const) {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; throw new Error('unexpected provider call'); }) as typeof fetch;
    const result = await provider(fetchImpl, terms).verifyReservationAuthority(selection);
    assert.equal(result.status, expected);
    assert.equal(calls, 0);
  }
});

test('missing match is unavailable while ambiguous or incomplete pagination fails closed', async () => {
  const missing = await provider(baseFetch(() => response(page([offering('other', 'OTHER')], 1)))).verifyReservationAuthority(selection);
  assert.equal(missing.status, 'UNAVAILABLE');
  await assert.rejects(() => provider(baseFetch(() => response(page([offering('a', 'KHATHR'), offering('b', 'KHATHR')], 2)))).verifyReservationAuthority(selection), (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE');
  await assert.rejects(() => provider(baseFetch(() => response(page([offering('a', 'OTHER')], 2, 2)))).verifyReservationAuthority(selection), (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE');
});

test('Travelport authentication rejection stays provider-neutral', async () => {
  const fetchImpl = baseFetch(() => response({ error: 'not exposed' }, 401));
  await assert.rejects(() => provider(fetchImpl).verifyReservationAuthority(selection), (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'AUTHENTICATION_FAILED' && error.retryable === false);
});
