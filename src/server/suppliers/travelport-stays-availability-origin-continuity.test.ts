import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysAvailabilitySelectionAuthorityFetch } from './travelport-stays-availability-selection-authority.ts';

const preProductionUrl = 'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality';
const productionUrl = 'https://api.travelport.net/11/hotel/availability/catalogofferingshospitality';

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

function responseBody(token = 'shared-token') {
  return {
    CatalogOfferingsHospitalityResponse: {
      CatalogOfferings: {
        totalCatalogOffering: 150,
        numberOfPages: 2,
        Identifier: { value: token },
        CatalogOffering: [{
          Identifier: { authority: 'TVPT', value: 'offer-1' },
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

test('Availability pagination token authority cannot cross Travelport environments', async () => {
  let calls = 0;
  const fetchImpl = createTravelportStaysAvailabilitySelectionAuthorityFetch((async () => {
    calls += 1;
    return jsonResponse(responseBody());
  }) as typeof fetch);

  await fetchImpl(preProductionUrl, { method: 'POST', body: JSON.stringify(requestBody()) });

  await assert.rejects(
    () => fetchImpl(`${productionUrl}/shared-token?pageNumber=2`, { method: 'GET' }),
    isInvalidRequest,
  );
  assert.equal(calls, 1);

  await assert.doesNotReject(
    () => fetchImpl(`${preProductionUrl}/shared-token?pageNumber=2`, { method: 'GET' }),
  );
  assert.equal(calls, 2);
});

test('identical opaque pagination tokens are independent per Travelport environment', async () => {
  let calls = 0;
  const fetchImpl = createTravelportStaysAvailabilitySelectionAuthorityFetch((async () => {
    calls += 1;
    return jsonResponse(responseBody());
  }) as typeof fetch);

  await assert.doesNotReject(
    () => fetchImpl(preProductionUrl, { method: 'POST', body: JSON.stringify(requestBody()) }),
  );
  await assert.doesNotReject(
    () => fetchImpl(productionUrl, { method: 'POST', body: JSON.stringify(requestBody()) }),
  );

  await assert.doesNotReject(
    () => fetchImpl(`${preProductionUrl}/shared-token?pageNumber=2`, { method: 'GET' }),
  );
  await assert.doesNotReject(
    () => fetchImpl(`${productionUrl}/shared-token?pageNumber=2`, { method: 'GET' }),
  );
  assert.equal(calls, 4);
});
