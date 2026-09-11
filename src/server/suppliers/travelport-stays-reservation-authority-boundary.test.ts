import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  assertTravelportStaysReservationAuthorityCacheKey,
  createTravelportStaysReservationAuthorityResponseFetch,
} from './travelport-stays-reservation-authority-boundary.ts';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function searchComplete() {
  return {
    hotelsResponse: {
      propertyItems: [{
        chainCode: 'HI',
        propertyCode: 'ABC12',
        roomTypes: [{
          rates: [{
            rateKey: { value: 'rate-key-1', authority: 'TVPT' },
            bookingCode: 'KHATHR',
            rateCodeInfo: {
              rateCode: 'THR',
              ratePlanID: 'THORPREFERRED',
              rateCategory: 'MultiLevel/Negotiated/Secure',
            },
            price: {
              currencyCode: 'USD',
              totalPrice: { amount: '147.65' },
            },
          }],
        }],
      }],
    },
  };
}

function availability() {
  return {
    CatalogOfferingsHospitalityResponse: {
      CatalogOfferings: {
        totalCatalogOffering: 1,
        catalogOfferingPerPage: 1,
        numberOfPages: 1,
        Identifier: { value: 'availability-page-token' },
        CatalogOffering: [{
          id: 'offer-1',
          Identifier: { value: 'offer-1', authority: 'TVPT' },
          TermsAndConditions: {
            ProductRateCodeInfo: {
              RateCodeInfo: {
                value: 'THR',
                rateID: 'THORPREFERRED',
                rateCategory: 'MultiLevel/Negotiated/Secure',
              },
            },
          },
          ProductOptions: [{
            Product: [{
              bookingCode: 'KHATHR',
              PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
              DateRange: { start: '2026-10-10', end: '2026-10-12' },
            }],
          }],
        }],
      },
    },
  };
}

function guardedResponse(url: string, payload: unknown) {
  const guarded = createTravelportStaysReservationAuthorityResponseFetch(
    (async () => jsonResponse(payload)) as typeof fetch,
  );
  return guarded(url);
}

function isInvalidResponse(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE';
}

test('canonical reservation authority SearchComplete and Availability evidence is preserved', async () => {
  const search = await guardedResponse('https://api.pp.travelport.net/12/hotel/search/searchcomplete', searchComplete());
  assert.equal(search.ok, true);

  const available = await guardedResponse('https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality', availability());
  assert.equal(available.ok, true);
});

test('SearchComplete machine evidence cannot gain authority through trimming or control stripping', async () => {
  const mutations = [
    (payload: ReturnType<typeof searchComplete>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.bookingCode = ' KHATHR'; },
    (payload: ReturnType<typeof searchComplete>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.rateCodeInfo.rateCode = 'THR\t'; },
    (payload: ReturnType<typeof searchComplete>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.rateKey.value = 'rate-key-1\u007f'; },
    (payload: ReturnType<typeof searchComplete>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.price.currencyCode = ' USD'; },
    (payload: ReturnType<typeof searchComplete>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.price.totalPrice.amount = '147.65 '; },
  ];

  for (const mutate of mutations) {
    const payload = searchComplete();
    mutate(payload);
    await assert.rejects(
      () => guardedResponse('https://api.pp.travelport.net/12/hotel/search/searchcomplete', payload),
      isInvalidResponse,
    );
  }
});

test('Availability sell and pagination evidence is exact before it can become submission authority', async () => {
  const mutations = [
    (payload: ReturnType<typeof availability>) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.Identifier.value = ' availability-page-token'; },
    (payload: ReturnType<typeof availability>) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0]!.Identifier.value = 'offer-1 '; },
    (payload: ReturnType<typeof availability>) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0]!.TermsAndConditions.ProductRateCodeInfo.RateCodeInfo.value = ' THR'; },
    (payload: ReturnType<typeof availability>) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0]!.ProductOptions[0]!.Product[0]!.bookingCode = 'KHATHR\u0000'; },
    (payload: ReturnType<typeof availability>) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0]!.ProductOptions[0]!.Product[0]!.PropertyKey.propertyCode = 'ABC12\u001f'; },
    (payload: ReturnType<typeof availability>) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0]!.ProductOptions[0]!.Product[0]!.DateRange.start = '2026-10-10 '; },
  ];

  for (const mutate of mutations) {
    const payload = availability();
    mutate(payload);
    await assert.rejects(
      () => guardedResponse('https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality', payload),
      isInvalidResponse,
    );
  }
});

test('reservation authority cache identity rejects whitespace and the full ASCII control range', () => {
  assert.doesNotThrow(() => assertTravelportStaysReservationAuthorityCacheKey('integration-123:v7'));
  for (const value of [' integration-123:v7', 'integration-123:v7 ', 'integration\t123', 'integration\u0000x', 'integration\u001fx', 'integration\u007fx']) {
    assert.throws(
      () => assertTravelportStaysReservationAuthorityCacheKey(value),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
    );
  }
});

test('non-hotel and non-success responses are not reinterpreted by the authority guard', async () => {
  let calls = 0;
  const guarded = createTravelportStaysReservationAuthorityResponseFetch((async () => {
    calls += 1;
    return new Response('{"bookingCode":" padded "}', { status: 503, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
  const response = await guarded('https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality');
  assert.equal(response.status, 503);
  assert.equal(calls, 1);

  const unrelated = createTravelportStaysReservationAuthorityResponseFetch((async () => jsonResponse({ bookingCode: ' padded ' })) as typeof fetch);
  assert.equal((await unrelated('https://example.test/health')).ok, true);
});
