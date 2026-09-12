import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysRulesSelectionAuthorityFetch } from './travelport-stays-rules-selection-authority.ts';

function invalidResponse(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE';
}

function rulesRequest(hotelAggregator: 'Travelport' | 'Booking' = 'Travelport', numberOfGuests = 2): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify({
      OfferQueryHospitalityRequest: {
        bookingCode: 'KHATHR',
        checkinDate: '2026-10-10',
        checkoutDate: '2026-10-12',
        numberOfGuests,
        HotelAggregator: hotelAggregator,
        PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
      },
    }),
  };
}

function rulesResponse(authority: 'TVPT' | 'BKNG' | null = 'TVPT') {
  return {
    OfferHospitalityResponse: {
      ...(authority ? { Identifier: { authority } } : {}),
      Offer: {
        Product: [{
          bookingCode: 'KHATHR',
          guests: 2,
          PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
          DateRange: { start: '2026-10-10', end: '2026-10-12' },
        }],
      },
    },
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

const rulesUrl = 'https://api.pp.travelport.net/11/hotel/rules/offershospitality/buildfromrequest';

test('canonical Rules source and exact selected product remain accepted', async () => {
  const guardedFetch = createTravelportStaysRulesSelectionAuthorityFetch(async () => jsonResponse(rulesResponse()));
  const response = await guardedFetch(rulesUrl, rulesRequest());
  assert.equal(response.status, 200);

  const bookingFetch = createTravelportStaysRulesSelectionAuthorityFetch(async () => jsonResponse(rulesResponse('BKNG')));
  await assert.doesNotReject(() => bookingFetch(rulesUrl, rulesRequest('Booking')));
});

test('present Rules response source must match the selected aggregator', async () => {
  const mismatchFetch = createTravelportStaysRulesSelectionAuthorityFetch(async () => jsonResponse(rulesResponse('BKNG')));
  await assert.rejects(() => mismatchFetch(rulesUrl, rulesRequest('Travelport')), invalidResponse);

  const malformed = rulesResponse();
  malformed.OfferHospitalityResponse.Identifier = { authority: 'Travelport' as never };
  const malformedFetch = createTravelportStaysRulesSelectionAuthorityFetch(async () => jsonResponse(malformed));
  await assert.rejects(() => malformedFetch(rulesUrl, rulesRequest()), invalidResponse);
});

test('Rules response must identify exactly one product for the selected property, booking code, and stay', async () => {
  const duplicate = rulesResponse();
  duplicate.OfferHospitalityResponse.Offer.Product.push({
    ...duplicate.OfferHospitalityResponse.Offer.Product[0]!,
    PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
    DateRange: { start: '2026-10-10', end: '2026-10-12' },
  });
  const duplicateFetch = createTravelportStaysRulesSelectionAuthorityFetch(async () => jsonResponse(duplicate));
  await assert.rejects(() => duplicateFetch(rulesUrl, rulesRequest()), invalidResponse);

  const wrongStay = rulesResponse();
  wrongStay.OfferHospitalityResponse.Offer.Product[0]!.DateRange.end = '2026-10-13';
  const wrongStayFetch = createTravelportStaysRulesSelectionAuthorityFetch(async () => jsonResponse(wrongStay));
  await assert.rejects(() => wrongStayFetch(rulesUrl, rulesRequest()), invalidResponse);
});

test('present Rules product guest count must equal request authority', async () => {
  const mismatch = rulesResponse();
  mismatch.OfferHospitalityResponse.Offer.Product[0]!.guests = 3;
  const mismatchFetch = createTravelportStaysRulesSelectionAuthorityFetch(async () => jsonResponse(mismatch));
  await assert.rejects(() => mismatchFetch(rulesUrl, rulesRequest()), invalidResponse);

  const absent = rulesResponse();
  delete (absent.OfferHospitalityResponse.Offer.Product[0] as { guests?: number }).guests;
  const absentFetch = createTravelportStaysRulesSelectionAuthorityFetch(async () => jsonResponse(absent));
  await assert.doesNotReject(() => absentFetch(rulesUrl, rulesRequest()));
});

test('missing response Identifier remains compatible while present contradictory authority fails closed', async () => {
  const guardedFetch = createTravelportStaysRulesSelectionAuthorityFetch(async () => jsonResponse(rulesResponse(null)));
  await assert.doesNotReject(() => guardedFetch(rulesUrl, rulesRequest()));
});

test('malformed Rules request authority fails before transport while unrelated successful JSON is untouched', async () => {
  let calls = 0;
  const guardedFetch = createTravelportStaysRulesSelectionAuthorityFetch(async () => {
    calls += 1;
    return jsonResponse({ access_token: 'token' });
  });
  await assert.rejects(() => guardedFetch(rulesUrl, rulesRequest('Travelport', 0)), invalidResponse);
  assert.equal(calls, 0);

  const oauth = await guardedFetch('https://auth.pp.travelport.net/oauth/token', { method: 'POST', body: 'grant_type=password' });
  assert.equal(oauth.status, 200);
  assert.equal(calls, 1);
});
