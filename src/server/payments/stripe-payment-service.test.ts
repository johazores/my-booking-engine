import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://sf_unit_test:sf_unit_test@127.0.0.1:5432/sf_unit_test';

const {
  isInternalPaymentClaimReference,
  paymentOperationClaimReference,
  paymentRequestFingerprint,
  stripeAuthorizationPersistenceStatus,
  stripeCapturePersistenceStatus,
} = await import('./stripe-payment-service.ts');

test('online payment request fingerprints are deterministic and input-sensitive', () => {
  const first = paymentRequestFingerprint(['stripe', 'authorize', 'booking-1', 'USD', '1000', 'pm_one']);
  const retry = paymentRequestFingerprint(['stripe', 'authorize', 'booking-1', 'USD', '1000', 'pm_one']);
  const changedPaymentMethod = paymentRequestFingerprint(['stripe', 'authorize', 'booking-1', 'USD', '1000', 'pm_two']);
  const changedOperation = paymentRequestFingerprint(['stripe', 'capture', 'booking-1', 'USD', '1000', 'pm_one']);

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, retry);
  assert.notEqual(first, changedPaymentMethod);
  assert.notEqual(first, changedOperation);
});

test('Stripe pre-provider claim references are deterministic internal markers only', () => {
  const fingerprint = paymentRequestFingerprint(['stripe', 'authorize', 'booking-1', 'USD', '1000', 'pm_one']);
  const reference = paymentOperationClaimReference(fingerprint);

  assert.equal(reference, `sf_claim_${fingerprint}`);
  assert.equal(isInternalPaymentClaimReference(reference), true);
  assert.equal(isInternalPaymentClaimReference('pi_123'), false);
  assert.equal(isInternalPaymentClaimReference('sf_claim_not-a-fingerprint'), false);
  assert.throws(() => paymentOperationClaimReference('bad'), /fingerprint is invalid/i);
});

test('Stripe authorization persistence maps only definitive provider states into booking state', () => {
  assert.deepEqual(stripeAuthorizationPersistenceStatus('AUTHORIZED'), {
    transactionStatus: 'SUCCEEDED',
    bookingPaymentStatus: 'AUTHORIZED',
  });
  assert.deepEqual(stripeAuthorizationPersistenceStatus('PAID'), {
    transactionStatus: 'SUCCEEDED',
    bookingPaymentStatus: 'PAID',
  });
  assert.deepEqual(stripeAuthorizationPersistenceStatus('PENDING'), {
    transactionStatus: 'PENDING',
    bookingPaymentStatus: 'UNPAID',
  });
  assert.deepEqual(stripeAuthorizationPersistenceStatus('FAILED'), {
    transactionStatus: 'FAILED',
    bookingPaymentStatus: 'FAILED',
  });
  assert.throws(() => stripeAuthorizationPersistenceStatus('REFUNDED'), /unsupported status/i);
});

test('Stripe capture persistence never marks a booking paid without provider proof', () => {
  assert.deepEqual(stripeCapturePersistenceStatus('PAID'), {
    transactionStatus: 'SUCCEEDED',
    bookingPaymentStatus: 'PAID',
  });
  assert.deepEqual(stripeCapturePersistenceStatus('PENDING'), {
    transactionStatus: 'PENDING',
    bookingPaymentStatus: 'AUTHORIZED',
  });
  assert.deepEqual(stripeCapturePersistenceStatus('FAILED'), {
    transactionStatus: 'FAILED',
    bookingPaymentStatus: 'AUTHORIZED',
  });
  assert.throws(() => stripeCapturePersistenceStatus('AUTHORIZED'), /unsupported status/i);
  assert.throws(() => stripeCapturePersistenceStatus('REFUNDED'), /unsupported status/i);
});
