import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { normalizeTravelportStaysConfiguration, TravelportStaysProvider } from './travelport-stays-provider.ts';

const configuration = normalizeTravelportStaysConfiguration({
  environment: 'pre-production',
  username: 'test-user',
  password: 'test-password',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  accessGroup: 'access-group',
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function propertySearchResponse() {
  return {
    pagination: { page: 1, pageSize: 1, totalPages: 1, totalItems: 1 },
    hotelsResponse: {
      propertyItems: [
        { name: 'Hotel One', chainCode: 'HI', propertyCode: 'ABC12', estimatedPropertyType: 'Hotel', availability: true },
      ],
    },
  };
}

function offerSearchResponse(total = 147.65) {
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
                    guaranteeType: 'DepositRequired',
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
                          currencyAmount: { amount: 147.65, currency: 'USD' },
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

async function loadPropertyReference(provider: TravelportStaysProvider) {
  const result = await provider.searchProperties({
    cityIataCode: 'SYD',
    checkInDateLocal: '2026-10-10',
    checkOutDateLocal: '2026-10-12',
    rooms: 1,
    adults: 2,
  });
  return result.properties[0]!.supplierPropertyReference;
}

const offerSearch = (supplierPropertyReference: string) => ({
  supplierPropertyReference,
  checkInDateLocal: '2026-10-10',
  checkOutDateLocal: '2026-10-12',
  rooms: 1,
  adults: 2,
  currency: 'usd',
} as const);

test('Travelport configuration advertises only implemented hotel search, availability and pricing capabilities', () => {
  assert.deepEqual(configuration.capabilities, ['availability', 'hotel-search', 'pricing']);
});

test('fresh property offer search uses a provider-specific no-cache request and returns exact normalized money and bounded terms', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let hotelCalls = 0;
  const provider = new TravelportStaysProvider({
    credentials: configuration.credentials,
    cacheKey: 'pricing-search:v1',
    now: () => new Date('2026-09-06T00:00:00.000Z'),
    fetchImpl: (async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
      hotelCalls += 1;
      return jsonResponse(hotelCalls === 1 ? propertySearchResponse() : offerSearchResponse());
    }) as typeof fetch,
  });

  const supplierPropertyReference = await loadPropertyReference(provider);
  const result = await provider.searchPropertyOffers(offerSearch(supplierPropertyReference));

  const request = requests.at(-1)!;
  assert.equal(request.url, 'https://api.pp.travelport.net/12/hotel/search/searchcomplete');
  const headers = new Headers(request.init?.headers);
  assert.equal(headers.get('TVP-Cache-Control'), 'no-cache');
  const body = JSON.parse(String(request.init?.body));
  assert.equal(body.requestedCurrency, 'USD');
  assert.deepEqual(body.propertyFilter, {
    propertyKeys: [{ chainCode: 'HI', propertyCode: 'ABC12', authority: 'TVPT' }],
    returnOnlyAvailableProperties: true,
  });
  assert.equal(body.returnCompleteNightlyRateBreakdown, true);

  assert.equal(result.providerCacheMode, 'NO_CACHE');
  assert.equal(result.validUntil, null);
  assert.equal(result.revalidationRequired, true);
  assert.equal(result.rulesRequiredBeforeReservation, true);
  assert.equal(result.observedAt, '2026-09-06T00:00:00.000Z');
  assert.equal(result.offers.length, 1);
  const offer = result.offers[0]!;
  assert.equal(offer.availableQuantity, 2);
  assert.equal(offer.price.currency, 'USD');
  assert.equal(offer.price.baseMinor, 12513n);
  assert.equal(offer.price.taxMinor, 2252n);
  assert.equal(offer.price.totalMinor, 14765n);
  assert.equal(offer.price.includedFeeMinor, 0n);
  assert.equal(offer.price.feesDueAtPropertyMinor, 1000n);
  assert.equal(offer.terms.paymentTiming, 'PREPAY');
  assert.equal(offer.terms.guaranteeType, 'DEPOSIT_REQUIRED');
  assert.equal(offer.terms.refundable, true);
  assert.equal(offer.terms.cancellationPenalties[0]?.money?.amountMinor, 14765n);
  assert.equal(offer.revalidationRequired, true);
  assert.equal(offer.rulesRequiredBeforeReservation, true);
  assert.ok(offer.supplierOfferReference.length > 20);
  assert.match(offer.offerFingerprint, /^[0-9a-f]{64}$/);
});

test('offer revalidation performs another fresh lookup and explicitly distinguishes unchanged and changed totals', async () => {
  let hotelCalls = 0;
  const provider = new TravelportStaysProvider({
    credentials: configuration.credentials,
    cacheKey: 'pricing-revalidation:v1',
    now: () => new Date('2026-09-06T00:01:00.000Z'),
    fetchImpl: (async (url) => {
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
      hotelCalls += 1;
      if (hotelCalls === 1) return jsonResponse(propertySearchResponse());
      if (hotelCalls === 2 || hotelCalls === 3) return jsonResponse(offerSearchResponse(147.65));
      return jsonResponse(offerSearchResponse(149.65));
    }) as typeof fetch,
  });

  const supplierPropertyReference = await loadPropertyReference(provider);
  const search = offerSearch(supplierPropertyReference);
  const initial = await provider.searchPropertyOffers(search);
  const offerReference = initial.offers[0]!.supplierOfferReference;

  const unchanged = await provider.revalidatePropertyOffer({ ...search, supplierOfferReference: offerReference, expectedTotalMinor: 14765n, expectedOfferFingerprint: initial.offers[0]!.offerFingerprint });
  assert.equal(unchanged.status, 'UNCHANGED');
  assert.equal(unchanged.offer?.price.totalMinor, 14765n);

  const changed = await provider.revalidatePropertyOffer({ ...search, supplierOfferReference: offerReference, expectedTotalMinor: 14765n, expectedOfferFingerprint: initial.offers[0]!.offerFingerprint });
  assert.equal(changed.status, 'PRICE_CHANGED');
  assert.equal(changed.offer?.price.totalMinor, 14965n);
  assert.equal(changed.validUntil, null);
});

test('offer revalidation detects non-price commercial changes through the normalized offer fingerprint', async () => {
  let hotelCalls = 0;
  const provider = new TravelportStaysProvider({
    credentials: configuration.credentials,
    cacheKey: 'pricing-revalidation-terms:v1',
    fetchImpl: (async (url) => {
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
      hotelCalls += 1;
      if (hotelCalls === 1) return jsonResponse(propertySearchResponse());
      if (hotelCalls === 2) return jsonResponse(offerSearchResponse());
      const response = offerSearchResponse();
      response.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.terms.refundable = false;
      return jsonResponse(response);
    }) as typeof fetch,
  });

  const supplierPropertyReference = await loadPropertyReference(provider);
  const search = offerSearch(supplierPropertyReference);
  const initial = await provider.searchPropertyOffers(search);
  const selected = initial.offers[0]!;
  const result = await provider.revalidatePropertyOffer({
    ...search,
    supplierOfferReference: selected.supplierOfferReference,
    expectedTotalMinor: selected.price.totalMinor,
    expectedOfferFingerprint: selected.offerFingerprint,
  });
  assert.equal(result.status, 'OFFER_CHANGED');
  assert.equal(result.offer?.price.totalMinor, selected.price.totalMinor);
  assert.equal(result.offer?.terms.refundable, false);
});

test('offer revalidation fails closed when the provider rate key is no longer returned', async () => {
  let hotelCalls = 0;
  const provider = new TravelportStaysProvider({
    credentials: configuration.credentials,
    cacheKey: 'pricing-unavailable:v1',
    fetchImpl: (async (url) => {
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
      hotelCalls += 1;
      if (hotelCalls === 1) return jsonResponse(propertySearchResponse());
      if (hotelCalls === 2) return jsonResponse(offerSearchResponse());
      const response = offerSearchResponse();
      response.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.rateKey.value = 'replacement-rate-key';
      return jsonResponse(response);
    }) as typeof fetch,
  });

  const supplierPropertyReference = await loadPropertyReference(provider);
  const search = offerSearch(supplierPropertyReference);
  const initial = await provider.searchPropertyOffers(search);
  const result = await provider.revalidatePropertyOffer({
    ...search,
    supplierOfferReference: initial.offers[0]!.supplierOfferReference,
    expectedTotalMinor: initial.offers[0]!.price.totalMinor,
    expectedOfferFingerprint: initial.offers[0]!.offerFingerprint,
  });
  assert.deepEqual(result.status, 'UNAVAILABLE');
  assert.equal(result.offer, null);
});

test('offer search rejects malformed money, mixed currencies and duplicate provider rate identities', async () => {
  const scenarios = [
    (payload: ReturnType<typeof offerSearchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.price.totalPrice.amount = 147.651 as never; },
    (payload: ReturnType<typeof offerSearchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!.price.currencyCode = 'AUD'; },
    (payload: ReturnType<typeof offerSearchResponse>) => { payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates.push(structuredClone(payload.hotelsResponse.propertyItems[0]!.roomTypes[0]!.rates[0]!)); },
    (payload: ReturnType<typeof offerSearchResponse>) => { payload.pagination.pageSize = 101; },
  ];

  for (const [index, mutate] of scenarios.entries()) {
    let hotelCalls = 0;
    const provider = new TravelportStaysProvider({
      credentials: configuration.credentials,
      cacheKey: `pricing-invalid:${index}`,
      fetchImpl: (async (url) => {
        if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
        hotelCalls += 1;
        if (hotelCalls === 1) return jsonResponse(propertySearchResponse());
        const payload = offerSearchResponse();
        mutate(payload);
        return jsonResponse(payload);
      }) as typeof fetch,
    });
    const supplierPropertyReference = await loadPropertyReference(provider);
    await assert.rejects(
      provider.searchPropertyOffers(offerSearch(supplierPropertyReference)),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('offer search and revalidation reject forged references, invalid currencies, and mismatched offer ownership', async () => {
  let hotelCalls = 0;
  const provider = new TravelportStaysProvider({
    credentials: configuration.credentials,
    cacheKey: 'pricing-inputs:v1',
    fetchImpl: (async (url) => {
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
      hotelCalls += 1;
      return jsonResponse(hotelCalls % 2 === 1 ? propertySearchResponse() : offerSearchResponse());
    }) as typeof fetch,
  });
  await assert.rejects(
    provider.searchPropertyOffers({ ...offerSearch('not-a-reference'), currency: 'USD' }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );

  const supplierPropertyReference = await loadPropertyReference(provider);
  await assert.rejects(
    provider.searchPropertyOffers({ ...offerSearch(supplierPropertyReference), currency: 'US' }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );

  const initial = await provider.searchPropertyOffers(offerSearch(supplierPropertyReference));
  const selected = initial.offers[0]!;
  const otherPropertyReference = Buffer.from(JSON.stringify({ chainCode: 'UR', propertyCode: 'OTHER1', authority: 'TVPT' }), 'utf8').toString('base64url');
  await assert.rejects(
    provider.revalidatePropertyOffer({
      ...offerSearch(otherPropertyReference),
      supplierOfferReference: selected.supplierOfferReference,
      expectedTotalMinor: selected.price.totalMinor,
      expectedOfferFingerprint: selected.offerFingerprint,
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
  await assert.rejects(
    provider.revalidatePropertyOffer({
      ...offerSearch(supplierPropertyReference),
      supplierOfferReference: selected.supplierOfferReference,
      expectedTotalMinor: selected.price.totalMinor,
      expectedOfferFingerprint: 'bad-fingerprint',
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
});
