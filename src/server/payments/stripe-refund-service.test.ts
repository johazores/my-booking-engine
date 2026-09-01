import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://sf_unit_test:sf_unit_test@127.0.0.1:5432/sf_unit_test';

const {
  nextStripeRefundBookingPaymentStatus,
  normalizeStripeRefundAmount,
  stripeRefundPersistenceStatus,
} = await import('./stripe-refund-service.ts');

test('Stripe refund amount parsing is exact and rejects unsafe values', () => {
  assert.equal(normalizeStripeRefundAmount(undefined), null);
  assert.equal(normalizeStripeRefundAmount('4100'), 4100n);
  assert.equal(normalizeStripeRefundAmount(4100n), 4100n);
  assert.throws(() => normalizeStripeRefundAmount('0'), /greater than zero/i);
  assert.throws(() => normalizeStripeRefundAmount('-1'), /positive integer/i);
  assert.throws(() => normalizeStripeRefundAmount(4100), /positive integer/i);
});

test('Stripe refund persistence only marks provider-proven refunds as succeeded', () => {
  assert.equal(stripeRefundPersistenceStatus('REFUNDED'), 'SUCCEEDED');
  assert.equal(stripeRefundPersistenceStatus('PENDING'), 'PENDING');
  assert.equal(stripeRefundPersistenceStatus('FAILED'), 'FAILED');
});

test('Stripe refund balance maps partial and full refunds without over-refunding', () => {
  assert.equal(nextStripeRefundBookingPaymentStatus({ sourceAmountMinor: 10000n, refundedBeforeMinor: 0n, refundAmountMinor: 2500n }), 'PARTIALLY_REFUNDED');
  assert.equal(nextStripeRefundBookingPaymentStatus({ sourceAmountMinor: 10000n, refundedBeforeMinor: 2500n, refundAmountMinor: 7500n }), 'REFUNDED');
  assert.throws(
    () => nextStripeRefundBookingPaymentStatus({ sourceAmountMinor: 10000n, refundedBeforeMinor: 2500n, refundAmountMinor: 7501n }),
    /exceeds the remaining refundable balance/i,
  );
});
