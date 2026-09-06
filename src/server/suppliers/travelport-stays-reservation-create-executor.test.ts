import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type { HospitalitySupplierReservationPaymentAuthority } from './hospitality-supplier-reservation-payment-authority.ts';
import type { TravelportStaysReservationCreateRequestMaterial } from './travelport-stays-reservation-create-request-material.ts';
import {
  TravelportStaysReservationCreateExecutor,
  buildTravelportStaysReservationCreateRequest,
} from './travelport-stays-reservation-create-executor.ts';

const credentials = Object.freeze({
  environment: 'pre-production' as const,
  username: 'user',
  password: 'password',
  clientId: 'client',
  clientSecret: 'secret',
  accessGroup: 'group',
});

const requestMaterial: TravelportStaysReservationCreateRequestMaterial = Object.freeze({
  BuildFromCatalogOfferingHospitality: Object.freeze({
    '@type': 'BuildFromCatalogOfferingHospitality' as const,
    CatalogOfferingIdentifier: Object.freeze({ value: 'offer-123' }),
  }),
  Traveler: Object.freeze([Object.freeze({
    '@type': 'Traveler' as const,
    PersonName: Object.freeze({ Given: 'Ada', Surname: 'Lovelace' }),
    Telephone: Object.freeze([Object.freeze({
      '@type': 'TelephoneDetail' as const,
      countryAccessCode: '61',
      areaCityCode: '2',
      phoneNumber: '98765432',
    })]),
    Email: Object.freeze([Object.freeze({ value: 'ada@example.com' })]),
  })]),
  Payment: Object.freeze([Object.freeze({
    '@type': 'Payment' as const,
    Amount: Object.freeze({ code: 'USD', value: '143.37' }),
    guaranteeInd: true,
    depositInd: false,
  })]),
});

const paymentAuthority: HospitalitySupplierReservationPaymentAuthority = Object.freeze({
  kind: 'GUARANTEE' as const,
  collectionTiming: 'AT_PROPERTY' as const,
  currency: 'USD',
  amountMinor: 14337n,
  acceptedPaymentCardCodes: Object.freeze(['VI', 'MC']),
});

const paymentCard = Object.freeze({
  cardType: 'Credit' as const,
  cardCode: 'VI',
  cardHolderName: 'Ada Lovelace',
  expireDate: '1227',
  cardNumber: '4111111111111111',
  securityCode: '123',
});

const expectedReservation = Object.freeze({
  chainCode: 'CN',
  propertyCode: 'B6381',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

function tokenResponse(status = 200) {
  return new Response(status === 200 ? JSON.stringify({ access_token: 'token', expires_in: 3600 }) : '{}', {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function confirmedResponse() {
  return new Response(JSON.stringify({
    ReservationResponse: {
      Reservation: {
        Offer: [{ Product: [{
          '@type': 'ProductHospitality',
          Quantity: 1,
          guests: 2,
          PropertyKey: { chainCode: 'CN', propertyCode: 'B6381' },
          DateRange: { start: '2026-10-10', end: '2026-10-12' },
        }] }],
        Receipt: [{
          Confirmation: {
            Locator: { value: '0GQ9HS', locatorType: 'PNR Locator', sourceContext: 'Travelport' },
            OfferStatus: { Status: 'Confirmed' },
          },
        }],
      },
      traceId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('builds the exact Travelport reference payload while keeping change-acceptance flags out of the initial sell', () => {
  const request = buildTravelportStaysReservationCreateRequest({
    requestMaterial,
    paymentAuthority,
    paymentCard,
    now: new Date('2026-09-07T00:00:00.000Z'),
  });

  assert.equal(request.ReservationQueryBuild.ReservationBuild['@type'], 'ReservationBuildFromCatalogOffering');
  assert.equal(request.ReservationQueryBuild.ReservationBuild.FormOfPayment[0].PaymentCard.CardCode, 'VI');
  assert.equal(request.ReservationQueryBuild.ReservationBuild.FormOfPayment[0].PaymentCard.SeriesCode.PlainText, '123');
  assert.deepEqual(request.ReservationQueryBuild.ReservationBuild.Payment, requestMaterial.Payment);
  assert.doesNotMatch(JSON.stringify(request), /acceptPriceChangeInd|acceptGuaranteeChangeInd/);
});

test('rejects malformed expected reservation evidence before OAuth, marker, or provider I/O', async () => {
  let calls = 0;
  let marked = false;
  const executor = new TravelportStaysReservationCreateExecutor({
    credentials,
    cacheKey: 'invalid-expected-reservation',
    fetchImpl: (async () => { calls += 1; return tokenResponse(); }) as typeof fetch,
    now: () => new Date('2026-09-07T00:00:00.000Z'),
  });

  await assert.rejects(
    executor.createReservation({
      requestCorrelationId: '5723a1b2-313d-4f60-90b7-d52b9582550e',
      requestMaterial,
      paymentAuthority,
      paymentCard,
      expectedReservation: { ...expectedReservation, rooms: 2 },
      beforeProviderRequest: async () => { marked = true; },
    }),
    (error) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
  assert.equal(calls, 0);
  assert.equal(marked, false);
});

test('a failed durable provider marker prevents the commercial POST', async () => {
  let calls = 0;
  const executor = new TravelportStaysReservationCreateExecutor({
    credentials,
    cacheKey: 'marker-failure',
    fetchImpl: (async (url: RequestInfo | URL) => {
      calls += 1;
      if (String(url).includes('/oauth/token')) return tokenResponse();
      return confirmedResponse();
    }) as typeof fetch,
    now: () => new Date('2026-09-07T00:00:00.000Z'),
  });
  const markerFailure = new Error('ledger marker rejected');

  await assert.rejects(
    executor.createReservation({
      requestCorrelationId: '8b6d4370-4b48-4421-9f0b-e0ac97c07c90',
      requestMaterial,
      paymentAuthority,
      paymentCard,
      expectedReservation,
      beforeProviderRequest: async () => { throw markerFailure; },
    }),
    (error) => error === markerFailure,
  );
  assert.equal(calls, 1);
});

test('rejects non-secret payment material that no longer matches fresh payment authority before any provider call', async () => {
  let calls = 0;
  let marked = false;
  const executor = new TravelportStaysReservationCreateExecutor({
    credentials,
    cacheKey: 'mismatched-payment-material',
    fetchImpl: (async () => { calls += 1; return tokenResponse(); }) as typeof fetch,
    now: () => new Date('2026-09-07T00:00:00.000Z'),
  });
  const mismatchedRequestMaterial: TravelportStaysReservationCreateRequestMaterial = Object.freeze({
    ...requestMaterial,
    Payment: Object.freeze([Object.freeze({
      ...requestMaterial.Payment[0],
      Amount: Object.freeze({ code: 'USD', value: '1.00' }),
    })]),
  });

  await assert.rejects(
    executor.createReservation({
      requestCorrelationId: '406ca123-8d9c-4cef-b95b-a93c3fb1832b',
      requestMaterial: mismatchedRequestMaterial,
      paymentAuthority,
      paymentCard,
      expectedReservation,
      beforeProviderRequest: async () => { marked = true; },
    }),
    (error) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && /no longer matches fresh supplier authority/i.test(error.message),
  );
  assert.equal(calls, 0);
  assert.equal(marked, false);
});

test('rejects payment-card material that is not authorized by fresh supplier terms before any provider call', async () => {
  let calls = 0;
  let marked = false;
  const executor = new TravelportStaysReservationCreateExecutor({
    credentials,
    cacheKey: 'invalid-card',
    fetchImpl: (async () => { calls += 1; return tokenResponse(); }) as typeof fetch,
    now: () => new Date('2026-09-07T00:00:00.000Z'),
  });

  await assert.rejects(
    executor.createReservation({
      requestCorrelationId: '9f77a0b5-2614-4f6d-9053-f3a6175343f7',
      requestMaterial,
      paymentAuthority,
      paymentCard: { ...paymentCard, cardCode: 'AX' },
      expectedReservation,
      beforeProviderRequest: async () => { marked = true; },
    }),
    (error) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
  assert.equal(calls, 0);
  assert.equal(marked, false);
});

test('acquires OAuth before the durable provider marker and submits only after the marker succeeds', async () => {
  const order: string[] = [];
  let createInit: RequestInit | undefined;
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const text = String(url);
    if (text.includes('/oauth/token')) {
      order.push('token');
      return tokenResponse();
    }
    order.push('create');
    createInit = init;
    assert.equal(text, 'https://api.pp.travelport.net/11/hotel/book/reservations/build');
    return confirmedResponse();
  }) as typeof fetch;
  const executor = new TravelportStaysReservationCreateExecutor({
    credentials,
    cacheKey: 'successful-create',
    fetchImpl,
    now: () => new Date('2026-09-07T00:00:00.000Z'),
  });

  const outcome = await executor.createReservation({
    requestCorrelationId: '9f77a0b5-2614-4f6d-9053-f3a6175343f7',
    requestMaterial,
    paymentAuthority,
    paymentCard,
    expectedReservation,
    beforeProviderRequest: async () => { order.push('marker'); },
  });

  assert.deepEqual(order, ['token', 'marker', 'create']);
  assert.equal(createInit?.method, 'POST');
  assert.equal(createInit?.redirect, 'manual');
  assert.equal(new Headers(createInit?.headers).get('E2ETrackingID'), 'sf-9f77a0b5-2614-4f6d-9053-f3a6175343f7');
  assert.equal(outcome.status, 'CONFIRMED');
  if (outcome.status === 'CONFIRMED') assert.equal(outcome.providerReservationReference, '0GQ9HS');
});

test('authentication failure happens before the durable provider-request marker', async () => {
  let marked = false;
  const executor = new TravelportStaysReservationCreateExecutor({
    credentials,
    cacheKey: 'auth-failure',
    fetchImpl: (async () => tokenResponse(401)) as typeof fetch,
    now: () => new Date('2026-09-07T00:00:00.000Z'),
  });

  await assert.rejects(
    executor.createReservation({
      requestCorrelationId: 'be85e0e0-7689-47aa-9928-589d3732965e',
      requestMaterial,
      paymentAuthority,
      paymentCard,
      expectedReservation,
      beforeProviderRequest: async () => { marked = true; },
    }),
    (error) => error instanceof HospitalitySupplierProviderError && error.code === 'AUTHENTICATION_FAILED',
  );
  assert.equal(marked, false);
});

test('network uncertainty after the durable marker stays ambiguous and cannot become a blind retry', async () => {
  let calls = 0;
  let marked = false;
  const executor = new TravelportStaysReservationCreateExecutor({
    credentials,
    cacheKey: 'network-ambiguity',
    fetchImpl: (async () => {
      calls += 1;
      if (calls === 1) return tokenResponse();
      throw new Error('connection dropped');
    }) as typeof fetch,
    now: () => new Date('2026-09-07T00:00:00.000Z'),
  });

  const outcome = await executor.createReservation({
    requestCorrelationId: 'a690c70a-f3fc-4c2e-b7ce-3cb6fa2b67e0',
    requestMaterial,
    paymentAuthority,
    paymentCard,
    expectedReservation,
    beforeProviderRequest: async () => { marked = true; },
  });
  assert.equal(marked, true);
  assert.deepEqual(outcome, {
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    supplierConfirmationReference: null,
    providerCorrelationId: null,
  });
});

test('requires bounded non-expired card data and a security code before OAuth or provider I/O', () => {
  for (const card of [
    { ...paymentCard, cardType: 'Debit' as never },
    { ...paymentCard, cardType: 'Gift' as never },
    { ...paymentCard, expireDate: '0826' },
    { ...paymentCard, expireDate: '1327' },
    { ...paymentCard, cardNumber: '1234' },
    { ...paymentCard, securityCode: '' },
    { ...paymentCard, securityCode: '12x' },
    { ...paymentCard, cardHolderName: ' Ada Lovelace ' },
  ]) {
    assert.throws(
      () => buildTravelportStaysReservationCreateRequest({
        requestMaterial,
        paymentAuthority,
        paymentCard: card,
        now: new Date('2026-09-07T00:00:00.000Z'),
      }),
      (error) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
    );
  }
});
