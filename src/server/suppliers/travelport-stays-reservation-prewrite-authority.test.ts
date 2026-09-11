import assert from 'node:assert/strict';
import test from 'node:test';

import type { HospitalitySupplierReservationPaymentAuthority } from './hospitality-supplier-reservation-payment-authority.ts';
import type { TravelportStaysReservationCreateRequestMaterial } from './travelport-stays-reservation-create-request-material.ts';
import { TravelportStaysReservationCreateExecutor } from './travelport-stays-reservation-create-executor.ts';
import { TravelportStaysReservationSyncExecutor } from './travelport-stays-reservation-sync-executor.ts';

const createCredentials = Object.freeze({
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
  acceptedPaymentCardCodes: Object.freeze(['VI']),
});

const paymentCard = Object.freeze({
  cardType: 'Credit' as const,
  cardCode: 'VI',
  cardHolderName: 'Ada Lovelace',
  expireDate: '1227',
  cardNumber: '4'.repeat(16),
  securityCode: '111',
});

function tokenResponse() {
  return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createConfirmedResponse() {
  return new Response(JSON.stringify({
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [{
          '@type': 'Offer',
          Product: [{
            '@type': 'ProductHospitality',
            Quantity: 1,
            guests: 2,
            PropertyKey: { chainCode: 'CN', propertyCode: 'B6381' },
            DateRange: { start: '2026-10-10', end: '2026-10-12' },
          }],
        }],
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

function syncConfirmedResponse() {
  return new Response(JSON.stringify({
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [{
          '@type': 'Offer',
          Identifier: { authority: 'BKNG' },
          Product: [{
            '@type': 'ProductHospitality',
            Quantity: 1,
            guests: 2,
            PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
            DateRange: { start: '2026-10-10', end: '2026-10-12' },
          }],
        }],
        Receipt: [
          {
            '@type': 'ReceiptConfirmation',
            Confirmation: {
              '@type': 'ConfirmationHold',
              Locator: {
                value: 'T9RY0-WQ842',
                locatorType: 'Confirmation Number',
                source: 'BO',
                sourceContext: 'Supplier',
              },
              OfferStatus: { '@type': 'OfferStatusHospitality', Status: 'Confirmed' },
            },
          },
          {
            '@type': 'ReceiptConfirmation',
            Confirmation: {
              '@type': 'ConfirmationHold',
              Locator: {
                value: '0GQ9HS',
                locatorType: 'PNR Locator',
                sourceContext: 'Travelport',
              },
              OfferStatus: { '@type': 'OfferStatusHospitality', Status: 'Confirmed' },
            },
          },
        ],
      },
      traceId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('Create keeps the original pre-write identity, correlation, and callbacks after OAuth starts', async () => {
  const expectedReservation = {
    chainCode: 'CN',
    propertyCode: 'B6381',
    arrivalDateLocal: '2026-10-10',
    departureDateLocal: '2026-10-12',
    rooms: 1,
    guests: 2,
  };
  let markerCalls = 0;
  let cardCalls = 0;
  const input = {
    requestCorrelationId: '9f77a0b5-2614-4f6d-9053-f3a6175343f7',
    requestMaterial,
    paymentAuthority,
    acquirePaymentCard: async () => { cardCalls += 1; return paymentCard; },
    expectedReservation,
    beforeProviderRequest: async () => { markerCalls += 1; },
  };

  const executor = new TravelportStaysReservationCreateExecutor({
    credentials: createCredentials,
    cacheKey: 'prewrite-create-mutation',
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/oauth/token')) {
        input.requestCorrelationId = '00000000-0000-4000-8000-000000000000';
        expectedReservation.propertyCode = 'MUTATED';
        input.acquirePaymentCard = async () => { throw new Error('mutated card callback must not run'); };
        input.beforeProviderRequest = async () => { throw new Error('mutated marker callback must not run'); };
        return tokenResponse();
      }
      assert.equal(new Headers(init?.headers).get('E2ETrackingID'), 'sf-9f77a0b5-2614-4f6d-9053-f3a6175343f7');
      return createConfirmedResponse();
    }) as typeof fetch,
    now: () => new Date('2026-09-07T00:00:00.000Z'),
  });

  const outcome = await executor.createReservation(input);
  assert.equal(cardCalls, 1);
  assert.equal(markerCalls, 1);
  assert.equal(outcome.status, 'CONFIRMED');
});

test('Sync keeps the original pre-write identity, confirmation, correlation, and marker after OAuth starts', async () => {
  const expectedReservation = {
    chainCode: 'HI',
    propertyCode: 'ABC12',
    arrivalDateLocal: '2026-10-10',
    departureDateLocal: '2026-10-12',
    rooms: 1,
    guests: 2,
  };
  const traveler = Object.freeze({
    firstName: 'Mary',
    lastName: 'Smith',
    email: 'mary@example.com',
    telephone: Object.freeze({
      countryCallingCode: '61',
      areaCode: '2',
      subscriberNumber: '91234567',
    }),
  });
  let markerCalls = 0;
  const input = {
    requestCorrelationId: '13b6a693-31e8-4a0d-895c-d0f620dbd1fa',
    providerRecoveryReference: 'travelport-stays-sync-v1:BKNG:BO',
    supplierConfirmationReference: 'T9RY0-WQ842',
    traveler,
    expectedReservation,
    beforeProviderRequest: async () => { markerCalls += 1; },
  };

  const executor = new TravelportStaysReservationSyncExecutor({
    credentials: createCredentials,
    cacheKey: 'prewrite-sync-mutation',
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/oauth/token')) {
        input.requestCorrelationId = '00000000-0000-4000-8000-000000000000';
        input.supplierConfirmationReference = 'MUTATED';
        expectedReservation.propertyCode = 'MUTATED';
        input.beforeProviderRequest = async () => { throw new Error('mutated marker callback must not run'); };
        return tokenResponse();
      }
      assert.equal(new Headers(init?.headers).get('E2ETrackingID'), 'sf-13b6a693-31e8-4a0d-895c-d0f620dbd1fa');
      return syncConfirmedResponse();
    }) as typeof fetch,
  });

  const outcome = await executor.syncReservation(input);
  assert.equal(markerCalls, 1);
  assert.deepEqual(outcome, {
    status: 'CONFIRMED',
    providerReservationReference: '0GQ9HS',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
  });
});
