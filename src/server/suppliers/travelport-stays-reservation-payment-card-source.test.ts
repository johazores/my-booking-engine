import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  acquireTravelportStaysReservationPaymentCard,
  type TravelportStaysReservationPaymentCardSource,
  type TravelportStaysReservationPaymentCardSourceContext,
} from './travelport-stays-reservation-payment-card-source.ts';

const context: TravelportStaysReservationPaymentCardSourceContext = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  reservationId: '22222222-2222-4222-8222-222222222222',
  integrationId: '33333333-3333-4333-8333-333333333333',
  integrationCredentialVersion: 3,
  attemptId: '44444444-4444-4444-8444-444444444444',
  purpose: 'INITIAL_CREATE',
});

const paymentCard = Object.freeze({
  cardType: 'Credit' as const,
  cardCode: 'VI',
  cardHolderName: 'Test Traveler',
  expireDate: '1230',
  cardNumber: '4'.repeat(16),
  securityCode: '1'.repeat(3),
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
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, integrationCredentialVersion: 2_147_483_648 }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, integrationCredentialVersion: Number.MAX_SAFE_INTEGER + 1 }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, purpose: 'UNKNOWN' }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, reservationId: ` ${context.reservationId}` }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, organizationId: 'organization-1' }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, reservationId: 'reservation-1' }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, integrationId: 'integration-1' }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, attemptId: 'attempt-1' }],
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

test('payment source failures preserve only typed retry authority and never propagate source-controlled error text', async () => {
  const sensitive = 'external-source-sensitive-diagnostic';
  for (const [thrown, expectedCode, expectedRetryable] of [
    [new Error(sensitive), 'INVALID_REQUEST', false],
    [new HospitalitySupplierProviderError('TIMEOUT', sensitive), 'TIMEOUT', true],
  ] as const) {
    await assert.rejects(
      () => acquireTravelportStaysReservationPaymentCard(Object.freeze({
        async acquirePaymentCard() { throw thrown; },
      }), context),
      (error: unknown) => {
        if (!(error instanceof HospitalitySupplierProviderError)) return false;
        assert.equal(error.code, expectedCode);
        assert.equal(error.retryable, expectedRetryable);
        assert.doesNotMatch(error.message, /external-source-sensitive-diagnostic/i);
        assert.match(error.message, /could not provide usable card material/i);
        return true;
      },
    );
  }
});

test('payment source sanitizes capability getter failures before acquisition', async () => {
  const source = Object.defineProperty({}, 'acquirePaymentCard', {
    get() {
      throw new HospitalitySupplierProviderError('PROVIDER_UNAVAILABLE', 'external-capability-sensitive-diagnostic');
    },
  });
  await assert.rejects(
    () => acquireTravelportStaysReservationPaymentCard(source as TravelportStaysReservationPaymentCardSource, context),
    (error: unknown) => {
      if (!(error instanceof HospitalitySupplierProviderError)) return false;
      assert.equal(error.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /external-capability-sensitive-diagnostic/i);
      return true;
    },
  );
});
