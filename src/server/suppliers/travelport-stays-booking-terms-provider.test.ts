import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { TravelportStaysBookingTermsProvider } from './travelport-stays-booking-terms-provider.ts';
import { normalizeTravelportStaysConfiguration, TravelportStaysProvider } from './travelport-stays-provider.ts';

const configuration = normalizeTravelportStaysConfiguration({
  environment: 'pre-production',
  username: 'test-user',
  password: 'test-password',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  accessGroup: 'access-group',
});

const propertyReference = Buffer.from(JSON.stringify({ chainCode: 'HI', propertyCode: 'ABC12', authority: 'TVPT' }), 'utf8').toString('base64url');

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function offerSearchResponse(total = 147.65, guaranteeType = 'DepositRequired') {
  return {
    pagination: { page: 1, pageSize: 1, totalPages: 1, totalItems: 1 },
    hotelsResponse: {
      propertyItems: [
        {
          name: 'Hotel One',
          chainCode: 'HI',
          propertyCode: 'ABC12',
          estimatedPropertyType: 'Hotel',
          availability: true,
          roomTypes: [
            {
              shortRoomDescription: '1 King Accessible Room',
              rates: [
                {
                  rateKey: { value: 'rate-key-1', authority: 'TVPT' },
                  bookingCode: 'KHATHR',
                  rateCodeInfo: {
                    rateCode: 'THR',
                    ratePlanID: 'THORPREFERRED',
                    rateCategory: 'MultiLevel/Negotiated/Secure',
                  },
                  rateDescription: 'Advance purchase',
                  roomDescription: '1 King Accessible Room',
                  quantity: 2,
                  wifiIncluded: true,
                  breakfastIncluded: true,
                  priceChangeProbability: 'Low',
                  price: {
                    currencyCode: 'USD',
                    base: { amount: 125.13 },
                    totalTaxes: { amount: 22.52 },
                    totalPrice: { amount: total },
                    totalIncludedFees: { amount: 0 },
                    totalFeesDueAtProperty: { amount: 10 },
                    taxesIncludedInBase: false,
                    resortFeeIncluded: false,
                    predictedPriceChangeDuringStay: false,
                  },
                  terms: {
                    ratePaymentInfo: 'PrePay',
                    guaranteeType,
                    paymentTypeEstimated: false,
                    customerLoyaltyIDRequiredAtReservation: false,
                    rateQualificationIDRequiredAtCheckIn: false,
                    refundable: true,
                    cancelNote: 'Rules must be confirmed before booking.',
                    cancelPenalties: [
                      {
                        deadlineLocal: '2026-10-09T18:00:00+11:00',
                        estimatedDeadlineLocal: false,
                        cancelShortDescription: 'One night after deadline',
                        penalty: {
                          estimatedAmount: false,
                          currencyAmount: { amount: total, currency: 'USD' },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function rulesResponse(guaranteeType = 'GuaranteeRequired') {
  return {
    OfferHospitalityResponse: {
      Offer: {
        '@type': 'Offer',
        Product: [
          {
            '@type': 'ProductHospitality',
            bookingCode: 'KHATHR',
            PropertyKey: { '@type': 'PropertyKey', chainCode: 'HI', propertyCode: 'ABC12' },
            DateRange: { start: '2026-10-10', end: '2026-10-12' },
          },
        ],
        Price: {
          '@type': 'PriceDetail',
          CurrencyCode: { value: 'USD', decimalPlace: 2 },
          Base: 125.13,
          TotalTaxes: 22.52,
          TotalFees: 0,
          TotalPrice: 147.65,
        },
        TermsAndConditionsFull: [
          {
            '@type': 'TermsAndConditionsFullHospitality',
            RatePaymentInfo: 'PrePay',
            CustomerLoyaltyIDRequiredAtReservation: false,
            RateQualificationIDRequiredAtCheckIn: false,
            TextBlock: [
              {
                '@type': 'TextBlock',
                title: 'Cancellation',
                TextFormatted: [{ language: 'EN', value: 'Cancel before the deadline to avoid the fee.' }],
              },
            ],
            Guarantee: [{ '@type': 'Guarantee', guaranteeType }],
            CancelPenalty: [
              {
                '@type': 'CancelPenalty',
                Description: 'Free cancellation before deadline.',
                Deadline: {
                  '@type': 'Deadline',
                  SpecificDate: { end: '2026-10-09' },
                  Time: '18:00:00',
                },
                HotelPenalty: { '@type': 'HotelPenaltyPercent', Percent: 0, appliesTo: 'Amount' },
                Refundable: 'Yes',
              },
              {
                '@type': 'CancelPenalty',
                Description: 'Full amount after deadline.',
                Deadline: { '@type': 'Deadline', SpecificDate: { start: '2026-10-10' } },
                HotelPenalty: { '@type': 'HotelPenaltyAmount', Amount: [{ code: 'USD', value: 147.65 }] },
                Refundable: 'No',
              },
            ],
            DepositPolicy: {
              Deposit: [{ remainderInd: true, Date: '2026-10-01', CurrencyAmount: { code: 'USD', value: 50 } }],
            },
            AcceptedCreditCard: [{ value: 'VI' }, { value: 'AX' }, { value: 'VI' }],
            CheckInOutPolicy: { checkInTime: '15:00:00', checkOutTime: '11:00:00' },
          },
        ],
      },
    },
  };
}

const offerSearch = {
  supplierPropertyReference: propertyReference,
  checkInDateLocal: '2026-10-10',
  checkOutDateLocal: '2026-10-12',
  rooms: 1,
  adults: 2,
  currency: 'USD',
} as const;

async function makeSelectedOffer(input: {
  cacheKey: string;
  fetchImpl: typeof fetch;
  now?: () => Date;
}) {
  const pricingProvider = new TravelportStaysProvider({
    credentials: configuration.credentials,
    cacheKey: `${input.cacheKey}:pricing`,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  const initial = await pricingProvider.searchPropertyOffers(offerSearch);
  const selected = initial.offers[0]!;
  return { pricingProvider, selected };
}

test('Travelport Rules preflight retrieves full terms only after exact SearchComplete bridge data and finishes with fresh offer revalidation', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const nowValues = [
    new Date('2026-09-06T01:00:00.000Z'),
    new Date('2026-09-06T01:00:01.000Z'),
    new Date('2026-09-06T01:00:02.000Z'),
    new Date('2026-09-06T01:00:03.000Z'),
    new Date('2026-09-06T01:00:04.000Z'),
  ];
  let nowIndex = 0;
  const now = () => nowValues[Math.min(nowIndex++, nowValues.length - 1)]!;
  const fetchImpl = (async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: `token-${requests.length}`, expires_in: 86400 });
    if (String(url).includes('/rules/')) return jsonResponse(rulesResponse());
    return jsonResponse(offerSearchResponse());
  }) as typeof fetch;

  const { pricingProvider, selected } = await makeSelectedOffer({ cacheKey: 'rules-ready', fetchImpl, now });
  const provider = new TravelportStaysBookingTermsProvider({
    credentials: configuration.credentials,
    cacheKey: 'rules-ready:terms',
    pricingProvider,
    fetchImpl,
    now,
  });
  const result = await provider.retrieveBookingTerms({
    ...offerSearch,
    supplierOfferReference: selected.supplierOfferReference,
    expectedTotalMinor: selected.price.totalMinor,
    expectedOfferFingerprint: selected.offerFingerprint,
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.offer?.offerFingerprint, selected.offerFingerprint);
  assert.equal(result.bookingTerms?.price.currency, 'USD');
  assert.equal(result.bookingTerms?.price.totalMinor, 14765n);
  assert.equal(result.bookingTerms?.price.baseMinor, 12513n);
  assert.equal(result.bookingTerms?.price.taxMinor, 2252n);
  assert.deepEqual(result.bookingTerms?.guaranteeTypes, ['GUARANTEE_REQUIRED']);
  assert.equal(result.bookingTerms?.paymentTiming, 'PREPAY');
  assert.equal(result.bookingTerms?.cancellationRules[0]?.penalty?.kind, 'PERCENT');
  assert.deepEqual(result.bookingTerms?.cancellationRules[1]?.penalty, {
    kind: 'AMOUNT', money: { currency: 'USD', amountMinor: 14765n },
  });
  assert.equal(result.bookingTerms?.deposits[0]?.money?.amountMinor, 5000n);
  assert.deepEqual(result.bookingTerms?.acceptedPaymentCardCodes, ['AX', 'VI']);
  assert.equal(result.bookingTerms?.checkInTimeLocal, '15:00:00');
  assert.equal(result.bookingTerms?.checkOutTimeLocal, '11:00:00');
  assert.equal(result.bookingTerms?.completeForReservationReview, true);
  assert.equal(result.bookingTerms?.revalidationRequired, true);
  assert.match(result.bookingTerms?.termsFingerprint ?? '', /^[0-9a-f]{64}$/);

  const rulesRequest = requests.find((request) => request.url.endsWith('/11/hotel/rules/offershospitality/buildfromrequest'))!;
  assert.ok(rulesRequest);
  const body = JSON.parse(String(rulesRequest.init?.body)).OfferQueryHospitalityRequest;
  assert.equal(body.bookingCode, 'KHATHR');
  assert.equal(body.storedAmount, '147.65');
  assert.equal(body.storedCurrency, 'USD');
  assert.equal(body.HotelAggregator, 'Travelport');
  assert.equal(body.numberOfGuests, 2);
  assert.deepEqual(body.PropertyKey, { '@type': 'PropertyKey', chainCode: 'HI', propertyCode: 'ABC12' });
  assert.equal(body.RateCandidate.rateCode, 'THR');
  assert.equal(body.RateCandidate.rateID, 'THORPREFERRED');
  assert.equal(body.RateCandidate.rateCategory, 'MultiLevel/Negotiated/Secure');
  assert.equal(body.RoomStayCandidates.RoomStayCandidate[0].GuestCounts.GuestCount[0].count, 2);

  const searchRequests = requests.filter((request) => request.url.endsWith('/12/hotel/search/searchcomplete'));
  assert.equal(searchRequests.length, 3);
  assert.equal(new Headers(searchRequests[1]!.init?.headers).get('TVP-Cache-Control'), 'no-cache');
});

test('Rules evidence is discarded when the final no-cache offer revalidation reports a price change', async () => {
  let searchCalls = 0;
  let rulesCalls = 0;
  const fetchImpl = (async (url) => {
    if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
    if (String(url).includes('/rules/')) {
      rulesCalls += 1;
      return jsonResponse(rulesResponse());
    }
    searchCalls += 1;
    return jsonResponse(offerSearchResponse(searchCalls >= 3 ? 149.65 : 147.65));
  }) as typeof fetch;

  const { pricingProvider, selected } = await makeSelectedOffer({ cacheKey: 'rules-change', fetchImpl });
  const provider = new TravelportStaysBookingTermsProvider({
    credentials: configuration.credentials,
    cacheKey: 'rules-change:terms',
    pricingProvider,
    fetchImpl,
  });
  const result = await provider.retrieveBookingTerms({
    ...offerSearch,
    supplierOfferReference: selected.supplierOfferReference,
    expectedTotalMinor: selected.price.totalMinor,
    expectedOfferFingerprint: selected.offerFingerprint,
  });

  assert.equal(rulesCalls, 1);
  assert.equal(result.status, 'PRICE_CHANGED');
  assert.equal(result.bookingTerms, null);
  assert.equal(result.offer?.price.totalMinor, 14965n);
});

test('Rules normalization stays fail-closed for unknown guarantee semantics and unsupported cancellation penalty types', async () => {
  for (const scenario of ['unknown-guarantee', 'bad-penalty'] as const) {
    const fetchImpl = (async (url) => {
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
      if (String(url).includes('/rules/')) {
        const payload = rulesResponse(scenario === 'unknown-guarantee' ? 'FutureGuaranteeType' : 'GuaranteeRequired');
        if (scenario === 'bad-penalty') payload.OfferHospitalityResponse.Offer.TermsAndConditionsFull[0]!.CancelPenalty[0]!.HotelPenalty['@type'] = 'FuturePenalty';
        return jsonResponse(payload);
      }
      return jsonResponse(offerSearchResponse());
    }) as typeof fetch;
    const { pricingProvider, selected } = await makeSelectedOffer({ cacheKey: scenario, fetchImpl });
    const provider = new TravelportStaysBookingTermsProvider({
      credentials: configuration.credentials,
      cacheKey: `${scenario}:terms`,
      pricingProvider,
      fetchImpl,
    });
    const request = {
      ...offerSearch,
      supplierOfferReference: selected.supplierOfferReference,
      expectedTotalMinor: selected.price.totalMinor,
      expectedOfferFingerprint: selected.offerFingerprint,
    };
    if (scenario === 'unknown-guarantee') {
      const result = await provider.retrieveBookingTerms(request);
      assert.equal(result.status, 'READY');
      assert.deepEqual(result.bookingTerms?.guaranteeTypes, ['UNKNOWN']);
      assert.equal(result.bookingTerms?.completeForReservationReview, false);
    } else {
      await assert.rejects(
        provider.retrieveBookingTerms(request),
        (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
      );
    }
  }
});

test('Rules preflight rejects unsupported multi-room and over-nine-guest shapes before provider transport', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({});
  }) as typeof fetch;
  const pricingProvider = new TravelportStaysProvider({
    credentials: configuration.credentials,
    cacheKey: 'rules-inputs:pricing',
    fetchImpl,
  });
  const provider = new TravelportStaysBookingTermsProvider({
    credentials: configuration.credentials,
    cacheKey: 'rules-inputs:terms',
    pricingProvider,
    fetchImpl,
  });
  const offerReference = Buffer.from(JSON.stringify({
    chainCode: 'HI',
    propertyCode: 'ABC12',
    propertyAuthority: 'TVPT',
    rateValue: 'rate-key-1',
    rateAuthority: 'TVPT',
  }), 'utf8').toString('base64url');
  const baseRequest = {
    ...offerSearch,
    supplierOfferReference: offerReference,
    expectedTotalMinor: 14765n,
    expectedOfferFingerprint: 'a'.repeat(64),
  };
  await assert.rejects(
    provider.retrieveBookingTerms({ ...baseRequest, rooms: 2 }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
  await assert.rejects(
    provider.retrieveBookingTerms({ ...baseRequest, adults: 9, childAges: [7] }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
  assert.equal(calls, 0);
});
