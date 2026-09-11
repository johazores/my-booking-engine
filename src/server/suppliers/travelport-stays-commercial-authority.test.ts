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
          shortRoomDescription: 'King room',
          rates: [{
            rateDescription: 'Advance purchase',
            roomDescription: 'King room',
            price: {
              currencyCode: 'USD',
              base: { amount: 125.13 },
              totalTaxes: { amount: 22.52 },
              totalPrice: { amount: 147.65 },
              totalIncludedFees: { amount: 0 },
              totalFeesDueAtProperty: { amount: 10 },
            },
            terms: {
              cancelNote: 'Rules must be confirmed before booking.',
              cancelPenalties: [{
                deadlineLocal: '2026-10-09T18:00:00+11:00',
                cancelShortDescription: 'One night after deadline',
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
        Product: [{
          bookingCode: 'KHATHR',
          PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
        }],
        Price: {
          CurrencyCode: { value: 'USD' },
          Base: 125.13,
          TotalTaxes: 22.52,
          TotalFees: 0,
          TotalPrice: 147.65,
        },
        TermsAndConditionsFull: [{
          RatePaymentInfo: 'PrePay',
          Guarantee: [{ guaranteeType: 'GuaranteeRequired' }],
          CancelPenalty: [
            {
              Description: 'Free cancellation before deadline.',
              HotelPenalty: { '@type': 'HotelPenaltyPercent', Percent: 0 },
            },
            {
              Description: 'Full amount after deadline.',
              HotelPenalty: { '@type': 'HotelPenaltyAmount', Amount: [{ code: 'USD', value: 147.65 }] },
            },
          ],
          DepositPolicy: {
            Deposit: [{ CurrencyAmount: { code: 'USD', value: 50 } }],
          },
          AcceptedCreditCard: [{ value: 'VI' }],
          TextBlock: [{
            title: 'Cancellation',
            TextFormatted: [{ language: 'EN', value: 'Cancel before the deadline to avoid the fee.' }],
          }],
        }],
      },
    },
  };
}

test('canonical SearchComplete and Rules commercial evidence remains accepted', () => {
  assert.doesNotThrow(() => assertTravelportStaysSearchCommercialAuthorityResponse(searchResponse()));
  assert.doesNotThrow(() => assertTravelportStaysRulesCommercialAuthorityResponse(rulesResponse()));
});

test('SearchComplete rejects money strings that only become valid after normalization', () => {
  for (const amount of [' 147.65', '147.65 ', '147\t.65', '147\u0000.65', '147\u007f.65']) {
    const payload = searchResponse();
    payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.price.totalPrice.amount = amount as never;
    assert.throws(() => assertTravelportStaysSearchCommercialAuthorityResponse(payload), invalidResponse);
  }
});

test('SearchComplete rejects normalization-confusable penalty amounts and commercial text controls', () => {
  const oversizedRateText = searchResponse();
  oversizedRateText.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.rateDescription = 'x'.repeat(501);
  assert.throws(() => assertTravelportStaysSearchCommercialAuthorityResponse(oversizedRateText), invalidResponse);

  const paddedAmount = searchResponse();
  paddedAmount.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.cancelPenalties[0]!.penalty.currencyAmount.amount = ' 147.65' as never;
  assert.throws(() => assertTravelportStaysSearchCommercialAuthorityResponse(paddedAmount), invalidResponse);

  const controlledText = searchResponse();
  controlledText.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.cancelNote = 'No refund\tafter deadline';
  assert.throws(() => assertTravelportStaysSearchCommercialAuthorityResponse(controlledText), invalidResponse);
});

test('Rules rejects normalized money and decimal authority before terms fingerprinting', () => {
  const cases = [
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.Price.TotalPrice = ' 147.65' as never; },
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CancelPenalty[0]!.HotelPenalty.Percent = ' 0' as never; },
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CancelPenalty[1]!.HotelPenalty.Amount![0]!.value = '147.65 ' as never; },
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.DepositPolicy.Deposit[0]!.CurrencyAmount.value = ' 50' as never; },
  ];
  for (const mutate of cases) {
    const payload = rulesResponse();
    mutate(payload);
    assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(payload), invalidResponse);
  }
});

test('Rules rejects machine tokens that only become authority after trimming', () => {
  for (const value of [' EN', 'EN ', 'E\tN', 'E\u0000N', 'E\u007fN']) {
    const payload = rulesResponse();
    payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.TextBlock[0]!.TextFormatted[0]!.language = value;
    assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(payload), invalidResponse);
  }

  const payment = rulesResponse();
  payment.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.RatePaymentInfo = ' PrePay';
  assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(payment), invalidResponse);

  const guarantee = rulesResponse();
  guarantee.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.Guarantee[0]!.guaranteeType = 'GuaranteeRequired ';
  assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(guarantee), invalidResponse);
});

test('Rules rejects commercial text that would be truncated or control-normalized before fingerprinting', () => {
  const oversizedDescription = rulesResponse();
  oversizedDescription.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CancelPenalty[0]!.Description = 'x'.repeat(1_001);
  assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(oversizedDescription), invalidResponse);

  const oversizedFormatted = rulesResponse();
  oversizedFormatted.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.TextBlock[0]!.TextFormatted[0]!.value = 'x'.repeat(2_001);
  assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(oversizedFormatted), invalidResponse);

  const controlled = rulesResponse();
  controlled.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CancelPenalty[0]!.Description = 'Free cancellation\nuntil 18:00';
  assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(controlled), invalidResponse);
});

test('Rules bounds optional deposit-policy traversal before compatibility normalization', () => {
  const payload = rulesResponse();
  payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.DepositPolicy = Array.from(
    { length: 17 },
    () => ({ Deposit: [] }),
  ) as never;
  assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(payload), invalidResponse);
});
