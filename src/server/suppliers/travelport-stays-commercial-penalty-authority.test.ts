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
            price: {
              currencyCode: 'USD',
              base: { amount: 125.13 },
              totalTaxes: { amount: 22.52 },
              totalPrice: { amount: 147.65 },
              totalIncludedFees: { amount: 0 },
              totalFeesDueAtProperty: { amount: 10 },
            },
            terms: {
              cancelPenalties: [{
                penalty: {
                  currencyAmount: { currency: 'USD', amount: 147.65 },
                },
              }],
            },
          }],
        }],
      }],
    },
  };
}

function rulesResponse(penalty: Record<string, unknown>) {
  return {
    OfferHospitalityResponse: {
      Offer: {
        Price: {
          CurrencyCode: { value: 'USD' },
          Base: 125.13,
          TotalTaxes: 22.52,
          TotalFees: 0,
          TotalPrice: 147.65,
        },
        TermsAndConditionsFull: [{
          CancelPenalty: [{ HotelPenalty: penalty }],
          DepositPolicy: {
            Deposit: [{ CurrencyAmount: { code: 'USD', value: 50 } }],
          },
        }],
      },
    },
  };
}

test('documented Rules cancellation penalty variants remain accepted', () => {
  assert.doesNotThrow(() => assertTravelportStaysRulesCommercialAuthorityResponse(
    rulesResponse({ '@type': 'HotelPenaltyAmount', Amount: [{ code: 'USD', value: 147.65 }] }),
  ));
  assert.doesNotThrow(() => assertTravelportStaysRulesCommercialAuthorityResponse(
    rulesResponse({ '@type': 'HotelPenaltyPercent', Percent: 100, appliesTo: 'Amount' }),
  ));
  assert.doesNotThrow(() => assertTravelportStaysRulesCommercialAuthorityResponse(
    rulesResponse({ '@type': 'HotelPenaltyNights', Nights: 1, subjectToTax: 'Unknown' }),
  ));
});

test('Rules rejects unsupported, incomplete, or contradictory cancellation penalty authority', () => {
  const penalties = [
    { '@type': 'HotelPenaltyPoints', Percent: 100 },
    { '@type': 'HotelPenaltyAmount' },
    { '@type': 'HotelPenaltyAmount', Amount: [{ code: 'USD', value: 10 }], Percent: 50 },
    { '@type': 'HotelPenaltyPercent' },
    { '@type': 'HotelPenaltyPercent', Percent: 50, appliesTo: 'Total' },
    { '@type': 'HotelPenaltyPercent', Percent: 50, Nights: 1 },
    { '@type': 'HotelPenaltyNights' },
    { '@type': 'HotelPenaltyNights', Nights: 1, Amount: [{ code: 'USD', value: 10 }] },
    { '@type': 'HotelPenaltyNights', Nights: 1, subjectToTax: 'Maybe' },
  ];
  for (const penalty of penalties) {
    assert.throws(
      () => assertTravelportStaysRulesCommercialAuthorityResponse(rulesResponse(penalty)),
      invalidResponse,
    );
  }
});

test('commercial money evidence must use plain non-negative decimal syntax', () => {
  for (const amount of ['147USD', '1e2', '+10', '1,000', '-1', 'NaN', 'Infinity']) {
    const search = searchResponse();
    search.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.price.totalPrice.amount = amount as never;
    assert.throws(() => assertTravelportStaysSearchCommercialAuthorityResponse(search), invalidResponse);

    const rules = rulesResponse({ '@type': 'HotelPenaltyAmount', Amount: [{ code: 'USD', value: 10 }] });
    rules.OfferHospitalityResponse.Offer.Price.TotalPrice = amount as never;
    assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(rules), invalidResponse);
  }

  const exponent = searchResponse();
  exponent.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.price.totalPrice.amount = 1e21;
  assert.throws(() => assertTravelportStaysSearchCommercialAuthorityResponse(exponent), invalidResponse);
});

test('Rules decimal penalty evidence rejects exponent-form numbers before compatibility normalization', () => {
  assert.throws(
    () => assertTravelportStaysRulesCommercialAuthorityResponse(
      rulesResponse({ '@type': 'HotelPenaltyPercent', Percent: 1e21, appliesTo: 'Amount' }),
    ),
    invalidResponse,
  );
  assert.throws(
    () => assertTravelportStaysRulesCommercialAuthorityResponse(
      rulesResponse({ '@type': 'HotelPenaltyNights', Nights: '1e1', subjectToTax: 'No' }),
    ),
    invalidResponse,
  );
});
