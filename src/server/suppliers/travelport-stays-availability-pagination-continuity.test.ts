import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysAvailabilitySelectionAuthorityFetch } from './travelport-stays-availability-selection-authority.ts';

const availabilityUrl = 'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality';

function requestBody() {
  return {
    CatalogOfferingsQueryRequest: {
      CatalogOfferingsRequest: [{
        '@type': 'CatalogOfferingsRequestHospitality',
        verboseResponseInd: true,
        StayDates: { start: '2026-10-10', end: '2026-10-12' },
        HotelSearchCriterion: {
          '@type': 'HotelSearchCriterion',
          numberOfRooms: 1,
          AggregatorList: ['TVPT'],
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
                GuestCount: [{ '@type': 'GuestCount', count: 2, ageQualifyingCode: '10' }],
              },
            }],
          },
        },
      }],
    },
  };
}

function responseBody(input: { total: number; pages: number; token?: string }) {
  return {
    CatalogOfferingsHospitalityResponse: {
      CatalogOfferings: {
        totalCatalogOffering: input.total,
        numberOfPages: input.pages,
        ...(input.pages > 1 ? { Identifier: { value: input.token ?? 'page-token' } } : {}),
        CatalogOffering: [{
          Identifier: { authority: 'TVPT', value: 'offer-1' },
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
              guests: 2,
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

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function isInvalidRequest(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST';
}

function isInvalidResponse(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE';
}

test('pagination page above the initial result-set page count fails before provider I/O', async () => {
  let calls = 0;
  const fetchImpl = createTravelportStaysAvailabilitySelectionAuthorityFetch((async () => {
    calls += 1;
    return jsonResponse(responseBody({ total: 250, pages: 3 }));
  }) as typeof fetch);

  await fetchImpl(availabilityUrl, { method: 'POST', body: JSON.stringify(requestBody()) });
  await assert.rejects(() => fetchImpl(`${availabilityUrl}/page-token?pageNumber=4`, { method: 'GET' }), isInvalidRequest);
  assert.equal(calls, 1);
});

test('continuation total and page count stay bound without consuming state on contradiction', async () => {
  const responses = [
    responseBody({ total: 250, pages: 3 }),
    responseBody({ total: 350, pages: 4 }),
    responseBody({ total: 250, pages: 3 }),
  ];
  let calls = 0;
  const fetchImpl = createTravelportStaysAvailabilitySelectionAuthorityFetch((async () => jsonResponse(responses[calls++]!)) as typeof fetch);

  await fetchImpl(availabilityUrl, { method: 'POST', body: JSON.stringify(requestBody()) });
  await assert.rejects(() => fetchImpl(`${availabilityUrl}/page-token?pageNumber=3`, { method: 'GET' }), isInvalidResponse);
  await assert.doesNotReject(() => fetchImpl(`${availabilityUrl}/page-token?pageNumber=3`, { method: 'GET' }));
  assert.equal(calls, 3);

  await assert.rejects(() => fetchImpl(`${availabilityUrl}/page-token?pageNumber=2`, { method: 'GET' }), isInvalidRequest);
  assert.equal(calls, 3);
});

test('non-consecutive continuation remains valid inside the page-one result set', async () => {
  const responses = [
    responseBody({ total: 250, pages: 3 }),
    responseBody({ total: 250, pages: 3 }),
  ];
  let calls = 0;
  const fetchImpl = createTravelportStaysAvailabilitySelectionAuthorityFetch((async () => jsonResponse(responses[calls++]!)) as typeof fetch);

  await fetchImpl(availabilityUrl, { method: 'POST', body: JSON.stringify(requestBody()) });
  await assert.doesNotReject(() => fetchImpl(`${availabilityUrl}/page-token?pageNumber=3`, { method: 'GET' }));
  assert.equal(calls, 2);
});

test('an active pagination token cannot be rebound even when result-set geometry matches', async () => {
  let calls = 0;
  const fetchImpl = createTravelportStaysAvailabilitySelectionAuthorityFetch((async () => {
    calls += 1;
    return jsonResponse(responseBody({ total: 250, pages: 3 }));
  }) as typeof fetch);

  await fetchImpl(availabilityUrl, { method: 'POST', body: JSON.stringify(requestBody()) });
  await assert.rejects(
    () => fetchImpl(availabilityUrl, { method: 'POST', body: JSON.stringify(requestBody()) }),
    isInvalidResponse,
  );
  assert.equal(calls, 2);
});
