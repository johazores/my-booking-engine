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
            wifiIncluded: true,
            breakfastIncluded: false,
            priceChangeProbability: 'Low',
            price: {
              currencyCode: 'USD',
              base: { amount: 125.13 },
              totalTaxes: { amount: 22.52 },
              totalPrice: { amount: 147.65 },
              taxesIncludedInBase: false,
              resortFeeIncluded: false,
              predictedPriceChangeDuringStay: false,
            },
            terms: {
              partialTermsCache: false,
              fullTermsCache: true,
              ratePaymentInfo: 'PrePay',
              guaranteeType: 'DepositRequired',
              paymentTypeEstimated: false,
              freeCancellationWithin24Hours: false,
              customerLoyaltyIDRequiredAtReservation: false,
              rateQualificationIDRequiredAtCheckIn: false,
              refundable: true,
              cancelPenalties: [{
                estimatedDeadlineLocal: true,
                penalty: {
                  estimatedAmount: true,
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

function rulesResponse() {
  return {
    OfferHospitalityResponse: {
      Offer: {
        Price: { CurrencyCode: { value: 'USD' }, TotalPrice: 147.65 },
        Product: [{ bookingCode: 'KHATHR', PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' } }],
        TermsAndConditionsFull: [{
          RatePaymentInfo: 'PostPay',
          CustomerLoyaltyIDRequiredAtReservation: false,
          RateQualificationIDRequiredAtCheckIn: true,
          Guarantee: [{ guaranteeType: 'GuaranteeRequired' }],
          CancelPenalty: [{
            Refundable: 'No',
            Deadline: {
              SpecificDate: { start: '2026-10-16', end: '2026-10-17' },
              Time: '23:59:00',
            },
            HotelPenalty: { '@type': 'HotelPenaltyAmount', Amount: [{ code: 'USD', value: 147.65 }] },
          }],
          DepositPolicy: {
            Deposit: [{ remainderInd: true, Date: '2026-10-01', CurrencyAmount: { code: 'USD', value: 50 } }],
          },
          CheckInOutPolicy: { checkInTime: '15:00:00', checkOutTime: '11:00' },
        }],
      },
    },
  };
}

test('canonical SearchComplete and Rules scalar commercial evidence remains accepted', () => {
  assert.doesNotThrow(() => assertTravelportStaysSearchCommercialAuthorityResponse(searchResponse()));
  assert.doesNotThrow(() => assertTravelportStaysRulesCommercialAuthorityResponse(rulesResponse()));
});

test('SearchComplete rejects malformed fingerprint-bearing booleans', () => {
  const cases = [
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.wifiIncluded = 'true' as never; },
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.price.taxesIncludedInBase = 'No' as never; },
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.refundable = 'Yes' as never; },
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.paymentTypeEstimated = 0 as never; },
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.cancelPenalties[0]!.estimatedDeadlineLocal = 'false' as never; },
    (payload: ReturnType<typeof searchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.cancelPenalties[0]!.penalty.estimatedAmount = 1 as never; },
  ];

  for (const mutate of cases) {
    const payload = searchResponse();
    mutate(payload);
    assert.throws(() => assertTravelportStaysSearchCommercialAuthorityResponse(payload), invalidResponse);
  }
});

test('SearchComplete rejects machine tokens that only become authority after trimming', () => {
  const payment = searchResponse();
  payment.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.ratePaymentInfo = ' PrePay';
  assert.throws(() => assertTravelportStaysSearchCommercialAuthorityResponse(payment), invalidResponse);

  const guarantee = searchResponse();
  guarantee.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.guaranteeType = 'DepositRequired ';
  assert.throws(() => assertTravelportStaysSearchCommercialAuthorityResponse(guarantee), invalidResponse);

  const probability = searchResponse();
  probability.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.priceChangeProbability = 'Low\t';
  assert.throws(() => assertTravelportStaysSearchCommercialAuthorityResponse(probability), invalidResponse);
});

test('Rules rejects malformed eligibility, refundability, deposit, and policy scalar authority', () => {
  const cases = [
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CustomerLoyaltyIDRequiredAtReservation = 'false' as never; },
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.RateQualificationIDRequiredAtCheckIn = 1 as never; },
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CancelPenalty[0]!.Refundable = 'Maybe' as never; },
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.DepositPolicy.Deposit[0]!.remainderInd = 'true' as never; },
  ];

  for (const mutate of cases) {
    const payload = rulesResponse();
    mutate(payload);
    assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(payload), invalidResponse);
  }
});

test('Rules rejects malformed deadline, deposit-date, and check-in/out authority', () => {
  const cases = [
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CancelPenalty[0]!.Deadline = 'tomorrow' as never; },
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CancelPenalty[0]!.Deadline.SpecificDate.start = '2026-02-30'; },
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CancelPenalty[0]!.Deadline.Time = '24:00:00'; },
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.DepositPolicy.Deposit[0]!.Date = '2026-13-01'; },
    (payload: ReturnType<typeof rulesResponse>) => { payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CheckInOutPolicy.checkInTime = '25:00'; },
  ];

  for (const mutate of cases) {
    const payload = rulesResponse();
    mutate(payload);
    assert.throws(() => assertTravelportStaysRulesCommercialAuthorityResponse(payload), invalidResponse);
  }
});

test('absent/null optional scalar authority remains compatible', () => {
  const search = searchResponse();
  search.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.wifiIncluded = null as never;
  search.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.refundable = null as never;
  assert.doesNotThrow(() => assertTravelportStaysSearchCommercialAuthorityResponse(search));

  const rules = rulesResponse();
  rules.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CustomerLoyaltyIDRequiredAtReservation = null as never;
  rules.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CancelPenalty[0]!.Refundable = null as never;
  rules.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.DepositPolicy.Deposit[0]!.Date = '';
  assert.doesNotThrow(() => assertTravelportStaysRulesCommercialAuthorityResponse(rules));
});
