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

function paginationOffering(index: number) {
  return {
    id: `page-offer-${index}`,
    Identifier: { value: `page-offer-${index}`, authority: 'TVPT' },
    ProductOptions: [],
  };
}

function availabilityPaginationPage(input: {
  total: number;
  pageSize: number;
  pages: number;
  identifier?: string;
  offset?: number;
}) {
  return {
    CatalogOfferingsHospitalityResponse: {
      CatalogOfferings: {
        totalCatalogOffering: input.total,
        catalogOfferingPerPage: input.pageSize,
        numberOfPages: input.pages,
        ...(input.identifier ? { Identifier: { value: input.identifier } } : {}),
        CatalogOffering: Array.from(
          { length: input.pageSize },
          (_, index) => paginationOffering((input.offset ?? 0) + index),
        ),
      },
    },
  };
}

function guardedResponse(url: string, payload: unknown, method: 'GET' | 'POST' = 'POST') {
  const guarded = createTravelportStaysReservationAuthorityResponseFetch(
    (async () => jsonResponse(payload)) as typeof fetch,
  );
  return guarded(url, { method });
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

test('reservation authority request shapes fail closed before provider I/O', async () => {
  let calls = 0;
  const guarded = createTravelportStaysReservationAuthorityResponseFetch((async () => {
    calls += 1;
    return jsonResponse({});
  }) as typeof fetch);

  for (const [url, method] of [
    ['https://api.pp.travelport.net/12/hotel/search/searchcomplete', 'GET'],
    ['https://api.pp.travelport.net/12/hotel/search/searchcomplete/extra', 'POST'],
    ['https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality', 'GET'],
    ['https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/token?pageNumber=2', 'POST'],
    ['https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/token?pageNumber=1', 'GET'],
    ['https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/token?pageNumber=2&pageNumber=3', 'GET'],
    ['https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/token/nested?pageNumber=2', 'GET'],
  ] as const) {
    await assert.rejects(() => guarded(url, { method }), isInvalidResponse);
  }
  assert.equal(calls, 0);
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

test('Availability sell evidence is exact before it can become submission authority', async () => {
  const mutations = [
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

test('Availability pagination metadata is bound to documented page geometry', async () => {
  const initial = availabilityPaginationPage({
    total: 101,
    pageSize: 100,
    pages: 2,
    identifier: 'availability-page-token',
  });
  assert.equal((await guardedResponse(
    'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality',
    initial,
  )).ok, true);

  const continuation = availabilityPaginationPage({ total: 101, pageSize: 1, pages: 2, offset: 100 });
  assert.equal((await guardedResponse(
    'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/availability-page-token?pageNumber=2',
    continuation,
    'GET',
  )).ok, true);

  for (const payload of [
    availabilityPaginationPage({ total: 101, pageSize: 100, pages: 1, identifier: 'availability-page-token' }),
    availabilityPaginationPage({ total: 101, pageSize: 99, pages: 2, identifier: 'availability-page-token' }),
    availabilityPaginationPage({ total: 101, pageSize: 100, pages: 2 }),
    availabilityPaginationPage({ total: 1, pageSize: 1, pages: 1, identifier: 'unexpected-token' }),
  ]) {
    await assert.rejects(
      () => guardedResponse('https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality', payload),
      isInvalidResponse,
    );
  }

  const wrongFinalPageSize = availabilityPaginationPage({ total: 101, pageSize: 2, pages: 2, offset: 100 });
  await assert.rejects(
    () => guardedResponse(
      'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/availability-page-token?pageNumber=2',
      wrongFinalPageSize,
      'GET',
    ),
    isInvalidResponse,
  );

  const paddedToken = availabilityPaginationPage({
    total: 101,
    pageSize: 100,
    pages: 2,
    identifier: ' availability-page-token',
  });
  await assert.rejects(
    () => guardedResponse('https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality', paddedToken),
    isInvalidResponse,
  );
});

test('authority response guard rejects oversized collections before compatibility parsing', async () => {
  const searchPayload = searchComplete();
  searchPayload.hotelsResponse.propertyItems.push(searchPayload.hotelsResponse.propertyItems[0]!);
  await assert.rejects(
    () => guardedResponse('https://api.pp.travelport.net/12/hotel/search/searchcomplete', searchPayload),
    isInvalidResponse,
  );

  const availabilityPayload = availability();
  const template = availabilityPayload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0]!;
  availabilityPayload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering = Array.from(
    { length: 101 },
    (_, index) => ({ ...template, id: `offer-${index}`, Identifier: { value: `offer-${index}`, authority: 'TVPT' } }),
  );
  await assert.rejects(
    () => guardedResponse('https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality', availabilityPayload),
    isInvalidResponse,
  );
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

test('non-authority and non-success responses are not reinterpreted by the authority guard', async () => {
  let calls = 0;
  const guarded = createTravelportStaysReservationAuthorityResponseFetch((async () => {
    calls += 1;
    return new Response('{"bookingCode":" padded "}', { status: 503, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
  const response = await guarded('https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality', { method: 'POST' });
  assert.equal(response.status, 503);
  assert.equal(calls, 1);

  const unrelated = createTravelportStaysReservationAuthorityResponseFetch((async () => jsonResponse({ bookingCode: ' padded ' })) as typeof fetch);
  assert.equal((await unrelated('https://example.test/health')).ok, true);
});
