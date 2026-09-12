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
            priceChangeProbability: 'Low',
            terms: {
              ratePaymentInfo: 'PrePay',
              guaranteeType: 'DepositRequired',
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
        TermsAndConditionsFull: [{
          RatePaymentInfo: 'PostPay',
          Guarantee: [{ guaranteeType: 'GuaranteeRequired' }],
          CancelPenalty: [{
            HotelPenalty: {
              '@type': 'HotelPenaltyNights',
              Nights: 1,
              subjectToTax: 'Unknown',
            },
          }],
        }],
      },
    },
  };
}

test('documented SearchComplete enums and Rules Unknown tax treatment remain accepted', () => {
  const search = searchResponse();
  search.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.ratePaymentInfo = 'Unknown';
  assert.doesNotThrow(() => assertTravelportStaysSearchCommercialAuthorityResponse(search));
  assert.doesNotThrow(() => assertTravelportStaysRulesCommercialAuthorityResponse(rulesResponse()));
});

test('SearchComplete rejects values outside current documented enum sets', () => {
  const cases = [
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.priceChangeProbability = 'Certain'; },
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.ratePaymentInfo = 'Deferred'; },
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.guaranteeType = 'Profile'; },
  ];

  for (const mutate of cases) {
    const payload = searchResponse();
    mutate(payload);
    assert.throws(() => assertTravelportStaysSearchCommercialAuthorityResponse(payload), invalidResponse);
  }
});

test('Rules rejects unsupported subjectToTax while preserving existing unknown-guarantee safety behavior', () => {
  const invalidTax = rulesResponse();
  invalidTax.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CancelPenalty[0]!.HotelPenalty.subjectToTax = 'Maybe';
  assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(invalidTax), invalidResponse);

  const unknownGuarantee = rulesResponse();
  unknownGuarantee.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.Guarantee[0]!.guaranteeType = 'FutureGuaranteeType';
  assert.doesNotThrow(() => assertTravelportStaysRulesCommercialAuthorityResponse(unknownGuarantee));
});
