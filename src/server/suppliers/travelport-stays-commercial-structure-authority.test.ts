import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  assertTravelportStaysRulesCommercialAuthorityResponse,
  assertTravelportStaysSearchCommercialAuthorityResponse,
} from './travelport-stays-commercial-authority.ts';

function invalidResponse(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE';
}

function searchResponse() {
  return {
    hotelsResponse: {
      propertyItems: [{
        roomTypes: [{
          rates: [{
            price: { currencyCode: 'USD', totalPrice: { amount: 147.65 } },
            terms: {
              cancelPenalties: [{
                penalty: { currencyAmount: { currency: 'USD', amount: 147.65 } },
              }],
            },
          }],
        }],
      }],
    },
  };
}

function rulesResponse() {
  return {
    OfferHospitalityResponse: {
      Offer: {
        Price: { CurrencyCode: { value: 'USD' }, TotalPrice: 147.65 },
        Product: [{ bookingCode: 'KHATHR', PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' } }],
      },
    },
  };
}

test('SearchComplete rejects present malformed nested commercial authority objects', () => {
  const cases = [
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.price = 'USD 147.65' as never; },
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms = 'non-refundable' as never; },
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.cancelPenalties[0]!.penalty = 'one night' as never; },
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.cancelPenalties[0]!.penalty.currencyAmount = 'USD 147.65' as never; },
  ];

  for (const mutate of cases) {
    const payload = searchResponse();
    mutate(payload);
    assert.throws(() => assertTravelportStaysSearchCommercialAuthorityResponse(payload), invalidResponse);
  }
});

test('Rules rejects present malformed nested commercial authority objects', () => {
  const cases = [
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.Price = 'USD 147.65' as never; },
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.Price.CurrencyCode = 'USD' as never; },
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.Product[0]!.PropertyKey = 'HI:ABC12' as never; },
  ];

  for (const mutate of cases) {
    const payload = rulesResponse();
    mutate(payload);
    assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(payload), invalidResponse);
  }
});

test('absent or null optional nested commercial authority remains compatible', () => {
  const search = searchResponse();
  search.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.price = null as never;
  search.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms = null as never;
  assert.doesNotThrow(() => assertTravelportStaysSearchCommercialAuthorityResponse(search));

  const rules = rulesResponse();
  rules.OfferHospitalityResponse.Offer.Price = null as never;
  rules.OfferHospitalityResponse.Offer.Product[0]!.PropertyKey = null as never;
  assert.doesNotThrow(() => assertTravelportStaysRulesCommercialAuthorityResponse(rules));
});
