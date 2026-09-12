import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysAvailabilitySelectionAuthorityFetch } from './travelport-stays-availability-selection-authority.ts';

const availabilityUrl = 'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality';

function isInvalidRequest(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST';
}

function isInvalidResponse(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE';
}

function requestBody(aggregator: 'TVPT' | 'BKNG' = 'TVPT') {
  return {
    CatalogOfferingsQueryRequest: {
      CatalogOfferingsRequest: [{
        '@type': 'CatalogOfferingsRequestHospitality',
        verboseResponseInd: true,
        StayDates: { start: '2026-10-10', end: '2026-10-12' },
        HotelSearchCriterion: {
          '@type': 'HotelSearchCriterion',
          numberOfRooms: 1,
          AggregatorList: [aggregator],
          RateCandidates: {
            '@type': 'RateCandidates',
            RateCandidate: [{
              '@type': 'RateCandidate',
              rateCode: 'THR',
              rateID: 'THORPREFERRED',
              rateCategory: 'MultiLevel/Negotiated/Secure',
              chainCode: 'HI',
              propertyCode: 'ABC12',
            }],
          },
          PropertyRequest: [{
            '@type': 'PropertyRequest',
            PropertyKey: { '@type': 'PropertyKey', chainCode: 'HI', propertyCode: 'ABC12' },
          }],
          RoomStayCandidates: {
            '@type': 'RoomStayCandidates',
            RoomStayCandidate: [{
              '@type': 'RoomStayCandidate',
              GuestCounts: {
                '@type': 'GuestCounts',
                GuestCount: [
                  { '@type': 'GuestCount', count: 2, ageQualifyingCode: '10' },
                  { '@type': 'GuestCount', count: 1, ageQualifyingCode: '8', age: 7 },
                ],
              },
            }],
          },
        },
      }],
    },
  };
}

function responseBody(authority: 'TVPT' | 'BKNG' = 'TVPT') {
  return {
    CatalogOfferingsHospitalityResponse: {
      CatalogOfferings: {
        numberOfPages: 1,
        CatalogOffering: [{
          Identifier: { authority, value: 'offer-1' },
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
              guests: 3,
              Quantity: 1,
              PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
              DateRange: { start: '2026-10-10', end: '2026-10-12' },
            }],
          }],
        }],
      },
    },
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function guarded(payload: unknown, calls?: { value: number }) {
  return createTravelportStaysAvailabilitySelectionAuthorityFetch((async () => {
    if (calls) calls.value += 1;
    return jsonResponse(payload);
  }) as typeof fetch);
}

test('canonical Travelport and Booking Availability selection authority is accepted', async () => {
  const tvpt = guarded(responseBody('TVPT'));
  await assert.doesNotReject(() => tvpt(availabilityUrl, {
    method: 'POST',
    body: JSON.stringify(requestBody('TVPT')),
  }));

  const bkng = guarded(responseBody('BKNG'));
  await assert.doesNotReject(() => bkng(availabilityUrl, {
    method: 'POST',
    body: JSON.stringify(requestBody('BKNG')),
  }));
});

test('malformed Availability request authority fails before provider I/O', async () => {
  for (const url of [
    'http://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality',
    'https://api.pp.travelport.net:444/11/hotel/availability/catalogofferingshospitality',
    'https://user:pass@api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality',
    'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality?unexpected=1',
  ]) {
    const calls = { value: 0 };
    const fetchImpl = guarded(responseBody(), calls);
    await assert.rejects(() => fetchImpl(url, {
      method: 'POST',
      body: JSON.stringify(requestBody()),
    }), isInvalidRequest);
    assert.equal(calls.value, 0);
  }

  const wrongMethodCalls = { value: 0 };
  const wrongMethodFetch = guarded(responseBody(), wrongMethodCalls);
  await assert.rejects(() => wrongMethodFetch(availabilityUrl, {
    method: 'PUT',
    body: JSON.stringify(requestBody()),
  }), isInvalidRequest);
  assert.equal(wrongMethodCalls.value, 0);

  const mutations = [
    (body: ReturnType<typeof requestBody>) => { body.CatalogOfferingsQueryRequest.CatalogOfferingsRequest[0]!.verboseResponseInd = false; },
    (body: ReturnType<typeof requestBody>) => { body.CatalogOfferingsQueryRequest.CatalogOfferingsRequest[0]!.StayDates.end = '2026-10-09'; },
    (body: ReturnType<typeof requestBody>) => { body.CatalogOfferingsQueryRequest.CatalogOfferingsRequest[0]!.HotelSearchCriterion.numberOfRooms = 2; },
    (body: ReturnType<typeof requestBody>) => { body.CatalogOfferingsQueryRequest.CatalogOfferingsRequest[0]!.HotelSearchCriterion.AggregatorList = ['BAD' as never]; },
    (body: ReturnType<typeof requestBody>) => { body.CatalogOfferingsQueryRequest.CatalogOfferingsRequest[0]!.HotelSearchCriterion.PropertyRequest[0]!.PropertyKey.propertyCode = ' ABC12'; },
    (body: ReturnType<typeof requestBody>) => { body.CatalogOfferingsQueryRequest.CatalogOfferingsRequest[0]!.HotelSearchCriterion.RoomStayCandidates.RoomStayCandidate[0]!.GuestCounts.GuestCount[0]!.count = 9; },
    (body: ReturnType<typeof requestBody>) => { body.CatalogOfferingsQueryRequest.CatalogOfferingsRequest[0]!.HotelSearchCriterion.RateCandidates.RateCandidate[0]!.chainCode = 'XX'; },
  ];

  for (const mutate of mutations) {
    const body = requestBody();
    mutate(body);
    const calls = { value: 0 };
    const fetchImpl = guarded(responseBody(), calls);
    await assert.rejects(() => fetchImpl(availabilityUrl, {
      method: 'POST',
      body: JSON.stringify(body),
    }), isInvalidRequest);
    assert.equal(calls.value, 0);
  }
});

test('Availability response supplier authority must match the requested aggregator', async () => {
  const fetchImpl = guarded(responseBody('BKNG'));
  await assert.rejects(() => fetchImpl(availabilityUrl, {
    method: 'POST',
    body: JSON.stringify(requestBody('TVPT')),
  }), isInvalidResponse);
});

test('present Availability product guest, quantity, property, and stay evidence must match the request', async () => {
  const mutations = [
    (payload: ReturnType<typeof responseBody>) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0]!.ProductOptions[0]!.Product[0]!.guests = 2; },
    (payload: ReturnType<typeof responseBody>) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0]!.ProductOptions[0]!.Product[0]!.Quantity = 0; },
    (payload: ReturnType<typeof responseBody>) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0]!.ProductOptions[0]!.Product[0]!.PropertyKey.propertyCode = 'OTHER'; },
    (payload: ReturnType<typeof responseBody>) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0]!.ProductOptions[0]!.Product[0]!.DateRange.end = '2026-10-13'; },
  ];

  for (const mutate of mutations) {
    const payload = responseBody();
    mutate(payload);
    const fetchImpl = guarded(payload);
    await assert.rejects(() => fetchImpl(availabilityUrl, {
      method: 'POST',
      body: JSON.stringify(requestBody()),
    }), isInvalidResponse);
  }
});

test('present Availability rate-candidate evidence cannot contradict the requested rate', async () => {
  for (const field of ['value', 'rateID', 'rateCategory'] as const) {
    const payload = responseBody();
    payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0]!.TermsAndConditions.ProductRateCodeInfo.RateCodeInfo[field] = 'DIFFERENT';
    const fetchImpl = guarded(payload);
    await assert.rejects(() => fetchImpl(availabilityUrl, {
      method: 'POST',
      body: JSON.stringify(requestBody()),
    }), isInvalidResponse);
  }
});

test('optional product and rate evidence may remain absent without inventing authority', async () => {
  const payload = responseBody();
  const offering = payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0]!;
  delete (offering as typeof offering & { TermsAndConditions?: unknown }).TermsAndConditions;
  const product = offering.ProductOptions[0]!.Product[0]! as typeof offering.ProductOptions[0]['Product'][0] & {
    guests?: number;
    Quantity?: number;
    PropertyKey?: unknown;
    DateRange?: unknown;
  };
  delete product.guests;
  delete product.Quantity;
  delete product.PropertyKey;
  delete product.DateRange;

  const fetchImpl = guarded(payload);
  await assert.doesNotReject(() => fetchImpl(availabilityUrl, {
    method: 'POST',
    body: JSON.stringify(requestBody()),
  }));
});


test('Availability pagination remains bound to the initial selection authority', async () => {
  const firstPayload = responseBody('TVPT');
  const firstCatalog = firstPayload.CatalogOfferingsHospitalityResponse.CatalogOfferings as typeof firstPayload.CatalogOfferingsHospitalityResponse.CatalogOfferings & {
    Identifier?: { value: string };
    numberOfPages?: number;
  };
  firstCatalog.Identifier = { value: 'page-token' };
  firstCatalog.numberOfPages = 3;

  const secondPayload = responseBody('TVPT');
  const secondCatalog = secondPayload.CatalogOfferingsHospitalityResponse.CatalogOfferings as typeof secondPayload.CatalogOfferingsHospitalityResponse.CatalogOfferings & {
    numberOfPages?: number;
  };
  secondCatalog.numberOfPages = 3;

  const thirdPayload = responseBody('TVPT');
  const thirdCatalog = thirdPayload.CatalogOfferingsHospitalityResponse.CatalogOfferings as typeof thirdPayload.CatalogOfferingsHospitalityResponse.CatalogOfferings & {
    numberOfPages?: number;
  };
  thirdCatalog.numberOfPages = 3;

  const responses = [firstPayload, secondPayload, thirdPayload];
  let calls = 0;
  const fetchImpl = createTravelportStaysAvailabilitySelectionAuthorityFetch((async () => {
    const payload = responses[calls];
    calls += 1;
    return jsonResponse(payload);
  }) as typeof fetch);

  await assert.doesNotReject(() => fetchImpl(availabilityUrl, {
    method: 'POST',
    body: JSON.stringify(requestBody()),
  }));
  await assert.doesNotReject(() => fetchImpl(
    'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/page-token?pageNumber=2',
    { method: 'GET' },
  ));
  await assert.doesNotReject(() => fetchImpl(
    'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/page-token?pageNumber=3',
    { method: 'GET' },
  ));
  assert.equal(calls, 3);

  await assert.rejects(() => fetchImpl(
    'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/page-token?pageNumber=3',
    { method: 'GET' },
  ), isInvalidRequest);
  assert.equal(calls, 3);
});

test('Availability pagination cannot use an unbound token or contradictory continuation evidence', async () => {
  const calls = { value: 0 };
  const unbound = guarded(responseBody(), calls);
  await assert.rejects(() => unbound(
    'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/unbound?pageNumber=2',
    { method: 'GET' },
  ), isInvalidRequest);
  assert.equal(calls.value, 0);

  const firstPayload = responseBody('TVPT');
  const firstCatalog = firstPayload.CatalogOfferingsHospitalityResponse.CatalogOfferings as typeof firstPayload.CatalogOfferingsHospitalityResponse.CatalogOfferings & {
    Identifier?: { value: string };
    numberOfPages?: number;
  };
  firstCatalog.Identifier = { value: 'bound-token' };
  firstCatalog.numberOfPages = 2;
  const responses = [firstPayload, responseBody('BKNG')];
  let responseIndex = 0;
  const fetchImpl = createTravelportStaysAvailabilitySelectionAuthorityFetch((async () => jsonResponse(responses[responseIndex++]!)) as typeof fetch);
  await fetchImpl(availabilityUrl, { method: 'POST', body: JSON.stringify(requestBody('TVPT')) });
  await assert.rejects(() => fetchImpl(
    'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/bound-token?pageNumber=2',
    { method: 'GET' },
  ), isInvalidResponse);
});

test('non-success and unrelated requests are not reinterpreted by Availability selection authority', async () => {
  let calls = 0;
  const fetchImpl = createTravelportStaysAvailabilitySelectionAuthorityFetch((async () => {
    calls += 1;
    return jsonResponse({ arbitrary: true }, 503);
  }) as typeof fetch);
  const response = await fetchImpl(availabilityUrl, {
    method: 'POST',
    body: JSON.stringify(requestBody()),
  });
  assert.equal(response.status, 503);

  const unrelated = await fetchImpl('https://example.test/11/hotel/availability/catalogofferingshospitality', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(unrelated.status, 503);
  assert.equal(calls, 2);
});
