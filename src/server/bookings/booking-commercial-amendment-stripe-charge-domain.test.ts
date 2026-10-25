import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reconcileStripeCommercialAmendmentChargeSnapshot,
  stripeCommercialAmendmentChargeFingerprint,
  stripeCommercialAmendmentChargeOperationKey,
  stripeCommercialAmendmentChargePersistenceStatus,
  stripeCommercialAmendmentDirectCaptureIdempotencyKey,
} from './booking-commercial-amendment-stripe-charge-domain.ts';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const AMENDMENT_ID = '22222222-2222-4222-8222-222222222222';

function snapshot(overrides: Partial<{
  providerReference: string;
  status: string;
  currency: string;
  amountMinor: bigint;
  amountReceivedMinor: bigint;
  amountCapturableMinor: bigint;
}> = {}) {
  return {
    providerReference: 'pi_adjustment123',
    status: 'requires_capture',
    currency: 'USD',
    amountMinor: 2500n,
    amountReceivedMinor: 0n,
    amountCapturableMinor: 2500n,
    ...overrides,
  };
}

test('operation keys are deterministic and stage-separated', () => {
  const auth = stripeCommercialAmendmentChargeOperationKey({ rootIdempotencyKey: 'request-key-123', bookingId: BOOKING_ID, amendmentId: AMENDMENT_ID, stage: 'AUTHORIZATION' });
  const repeated = stripeCommercialAmendmentChargeOperationKey({ rootIdempotencyKey: 'request-key-123', bookingId: BOOKING_ID, amendmentId: AMENDMENT_ID, stage: 'AUTHORIZATION' });
  const capture = stripeCommercialAmendmentChargeOperationKey({ rootIdempotencyKey: 'request-key-123', bookingId: BOOKING_ID, amendmentId: AMENDMENT_ID, stage: 'CAPTURE' });
  assert.equal(auth, repeated);
  assert.notEqual(auth, capture);
  assert.match(auth, /^ca-stripe-auth-[0-9a-f]{64}$/);
  assert.match(capture, /^ca-stripe-capture-[0-9a-f]{64}$/);
});

test('authorization fingerprint binds the payment method while capture binds the PaymentIntent', () => {
  const authA = stripeCommercialAmendmentChargeFingerprint({ bookingId: BOOKING_ID, amendmentId: AMENDMENT_ID, stage: 'AUTHORIZATION', currency: 'USD', amountMinor: 2500n, paymentMethodReference: 'pm_a' });
  const authB = stripeCommercialAmendmentChargeFingerprint({ bookingId: BOOKING_ID, amendmentId: AMENDMENT_ID, stage: 'AUTHORIZATION', currency: 'USD', amountMinor: 2500n, paymentMethodReference: 'pm_b' });
  const captureA = stripeCommercialAmendmentChargeFingerprint({ bookingId: BOOKING_ID, amendmentId: AMENDMENT_ID, stage: 'CAPTURE', currency: 'USD', amountMinor: 2500n, providerReference: 'pi_a' });
  const captureB = stripeCommercialAmendmentChargeFingerprint({ bookingId: BOOKING_ID, amendmentId: AMENDMENT_ID, stage: 'CAPTURE', currency: 'USD', amountMinor: 2500n, providerReference: 'pi_b' });
  assert.notEqual(authA, authB);
  assert.notEqual(captureA, captureB);
});

test('provider authorization states stay amendment-isolated', () => {
  assert.deepEqual(stripeCommercialAmendmentChargePersistenceStatus({ stage: 'AUTHORIZATION', providerStatus: 'AUTHORIZED' }), { transactionStatus: 'SUCCEEDED', directlySettled: false });
  assert.deepEqual(stripeCommercialAmendmentChargePersistenceStatus({ stage: 'AUTHORIZATION', providerStatus: 'PENDING' }), { transactionStatus: 'AMBIGUOUS', directlySettled: false });
  assert.deepEqual(stripeCommercialAmendmentChargePersistenceStatus({ stage: 'AUTHORIZATION', providerStatus: 'PAID' }), { transactionStatus: 'SUCCEEDED', directlySettled: true });
});

test('provider capture states stay amendment-isolated', () => {
  assert.deepEqual(stripeCommercialAmendmentChargePersistenceStatus({ stage: 'CAPTURE', providerStatus: 'PAID' }), { transactionStatus: 'SUCCEEDED', directlySettled: true });
  assert.deepEqual(stripeCommercialAmendmentChargePersistenceStatus({ stage: 'CAPTURE', providerStatus: 'PENDING' }), { transactionStatus: 'AMBIGUOUS', directlySettled: false });
  assert.deepEqual(stripeCommercialAmendmentChargePersistenceStatus({ stage: 'CAPTURE', providerStatus: 'FAILED' }), { transactionStatus: 'FAILED', directlySettled: false });
});

test('reconciliation recognizes an exact manual-capture authorization', () => {
  assert.deepEqual(reconcileStripeCommercialAmendmentChargeSnapshot({ stage: 'AUTHORIZATION', currency: 'USD', amountMinor: 2500n, providerReference: 'pi_adjustment123', snapshot: snapshot() }), { transactionStatus: 'SUCCEEDED', directlySettled: false });
});

test('reconciliation recognizes direct settlement and requires exact received money', () => {
  assert.deepEqual(reconcileStripeCommercialAmendmentChargeSnapshot({ stage: 'AUTHORIZATION', currency: 'USD', amountMinor: 2500n, providerReference: 'pi_adjustment123', snapshot: snapshot({ status: 'succeeded', amountReceivedMinor: 2500n, amountCapturableMinor: 0n }) }), { transactionStatus: 'SUCCEEDED', directlySettled: true });
  assert.throws(() => reconcileStripeCommercialAmendmentChargeSnapshot({ stage: 'AUTHORIZATION', currency: 'USD', amountMinor: 2500n, providerReference: 'pi_adjustment123', snapshot: snapshot({ status: 'succeeded', amountReceivedMinor: 2499n, amountCapturableMinor: 0n }) }), /settled amount/);
});

test('capture reconciliation succeeds only for exact settled money', () => {
  assert.deepEqual(reconcileStripeCommercialAmendmentChargeSnapshot({ stage: 'CAPTURE', currency: 'USD', amountMinor: 2500n, providerReference: 'pi_adjustment123', snapshot: snapshot({ status: 'succeeded', amountReceivedMinor: 2500n, amountCapturableMinor: 0n }) }), { transactionStatus: 'SUCCEEDED', directlySettled: true });
  assert.throws(() => reconcileStripeCommercialAmendmentChargeSnapshot({ stage: 'CAPTURE', currency: 'USD', amountMinor: 2500n, providerReference: 'pi_adjustment123', snapshot: snapshot({ status: 'succeeded', amountReceivedMinor: 2000n, amountCapturableMinor: 0n }) }), /captured amount/);
});

test('provider drift fails closed', () => {
  assert.throws(() => reconcileStripeCommercialAmendmentChargeSnapshot({ stage: 'CAPTURE', currency: 'USD', amountMinor: 2500n, providerReference: 'pi_adjustment123', snapshot: snapshot({ providerReference: 'pi_other' }) }), /different PaymentIntent/);
  assert.throws(() => reconcileStripeCommercialAmendmentChargeSnapshot({ stage: 'CAPTURE', currency: 'USD', amountMinor: 2500n, providerReference: 'pi_adjustment123', snapshot: snapshot({ currency: 'AUD' }) }), /money/);
});

test('direct settlement capture identity is deterministic', () => {
  const first = stripeCommercialAmendmentDirectCaptureIdempotencyKey({ bookingId: BOOKING_ID, amendmentId: AMENDMENT_ID, providerReference: 'pi_adjustment123' });
  const second = stripeCommercialAmendmentDirectCaptureIdempotencyKey({ bookingId: BOOKING_ID, amendmentId: AMENDMENT_ID, providerReference: 'pi_adjustment123' });
  assert.equal(first, second);
  assert.match(first, /^ca-stripe-direct-capture-[0-9a-f]{64}$/);
});

test('charge reconciliation rejects contradictory provider money and unknown statuses', () => {
  const reconcile = (stage: 'AUTHORIZATION' | 'CAPTURE', overrides: Parameters<typeof snapshot>[0]) =>
    reconcileStripeCommercialAmendmentChargeSnapshot({
      stage, currency: 'USD', amountMinor: 2500n, providerReference: 'pi_adjustment123',
      snapshot: snapshot(overrides),
    });
  assert.throws(() => reconcile('AUTHORIZATION', { amountReceivedMinor: 1n }), /contradictory charge money/);
  assert.throws(() => reconcile('AUTHORIZATION', { amountReceivedMinor: 1n, amountCapturableMinor: 2499n }), /capturable amount/);
  assert.throws(() => reconcile('CAPTURE', { status: 'succeeded', amountReceivedMinor: 2500n, amountCapturableMinor: 1n }), /contradictory charge money/);
  assert.throws(() => reconcile('AUTHORIZATION', { status: 'canceled' }), /received or capturable money/);
  assert.throws(() => reconcile('CAPTURE', { status: 'requires_payment_method' }), /received or capturable money/);
  assert.throws(() => reconcile('AUTHORIZATION', { status: 'unexpected' }), /unrecognized PaymentIntent status/);
  assert.deepEqual(reconcile('AUTHORIZATION', { status: 'canceled', amountCapturableMinor: 0n }), {
    transactionStatus: 'FAILED', directlySettled: false,
  });
});

test('commercial amendment charge identities cannot exceed the persisted reference limit', () => {
  const providerReference = `pi_${'x'.repeat(158)}`;
  assert.throws(
    () => reconcileStripeCommercialAmendmentChargeSnapshot({
      stage: 'CAPTURE', currency: 'USD', amountMinor: 2500n,
      providerReference, snapshot: snapshot({ providerReference }),
    }),
    /PaymentIntent reference/,
  );
  assert.throws(
    () => stripeCommercialAmendmentDirectCaptureIdempotencyKey({
      bookingId: BOOKING_ID, amendmentId: AMENDMENT_ID, providerReference,
    }),
    /PaymentIntent reference/,
  );
});
