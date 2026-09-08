import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  acquireTravelportStaysReservationPaymentCard,
  type TravelportStaysReservationPaymentCardSource,
  type TravelportStaysReservationPaymentCardSourceContext,
} from './travelport-stays-reservation-payment-card-source.ts';

const context: TravelportStaysReservationPaymentCardSourceContext = Object.freeze({
  organizationId: 'organization-1',
  reservationId: 'reservation-1',
  integrationId: 'integration-1',
  integrationCredentialVersion: 3,
  attemptId: 'attempt-1',
  purpose: 'INITIAL_CREATE',
});

const paymentCard = Object.freeze({
  cardType: 'Credit' as const,
  cardCode: 'VI',
  cardHolderName: 'Test Traveler',
  expireDate: '1230',
  cardNumber: '4111111111111111',
  securityCode: '123',
});

test('payment source receives only normalized execution context and is called once', async () => {
  let calls = 0;
  let receivedContext: TravelportStaysReservationPaymentCardSourceContext | null = null;
  const source: TravelportStaysReservationPaymentCardSource = Object.freeze({
    async acquirePaymentCard(value) {
      calls += 1;
      receivedContext = value;
      return paymentCard;
    },
  });

  const result = await acquireTravelportStaysReservationPaymentCard(source, context);

  assert.equal(calls, 1);
  assert.equal(result, paymentCard);
  assert.deepEqual(receivedContext, context);
  assert.equal(Object.isFrozen(receivedContext), true);
  assert.deepEqual(Object.keys(receivedContext ?? {}).sort(), [
    'attemptId',
    'integrationCredentialVersion',
    'integrationId',
    'organizationId',
    'purpose',
    'reservationId',
  ]);
});

test('payment source fails closed when the capability or execution context is invalid', async () => {
  const cases = [
    [null, context],
    [{}, context],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, integrationCredentialVersion: 0 }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, purpose: 'UNKNOWN' }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, reservationId: ' reservation-1' }],
  ] as const;

  for (const [source, invalidContext] of cases) {
    await assert.rejects(
      () => acquireTravelportStaysReservationPaymentCard(
        source as TravelportStaysReservationPaymentCardSource,
        invalidContext as TravelportStaysReservationPaymentCardSourceContext,
      ),
      (error: unknown) => (
        error instanceof HospitalitySupplierProviderError
        && error.code === 'INVALID_REQUEST'
        && error.retryable === false
      ),
    );
  }
});

test('payment source rejects an empty card result before the provider adapter is invoked', async () => {
  await assert.rejects(
    () => acquireTravelportStaysReservationPaymentCard(
      Object.freeze({
        async acquirePaymentCard() {
          return null as never;
        },
      }),
      context,
    ),
    (error: unknown) => (
      error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && error.retryable === false
    ),
  );
});
