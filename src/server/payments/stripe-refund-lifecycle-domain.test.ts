import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bookingPaymentStatusForRefundLifecycle,
  decideStripeRefundLifecycleMutation,
} from './stripe-refund-lifecycle-domain.ts';

test('pending and ambiguous refunds can resolve from current provider truth', () => {
  assert.deepEqual(
    decideStripeRefundLifecycleMutation({ currentStatus: 'PENDING', providerStatus: 'SUCCEEDED' }),
    { action: 'MUTATE', nextStatus: 'SUCCEEDED', processingNote: 'refund-state-reconciled' },
  );
  assert.deepEqual(
    decideStripeRefundLifecycleMutation({ currentStatus: 'AMBIGUOUS', providerStatus: 'FAILED' }),
    { action: 'MUTATE', nextStatus: 'FAILED', processingNote: 'refund-state-reconciled' },
  );
});

test('a previously successful Stripe refund can return to pending or fail', () => {
  assert.deepEqual(
    decideStripeRefundLifecycleMutation({ currentStatus: 'SUCCEEDED', providerStatus: 'PENDING' }),
    { action: 'MUTATE', nextStatus: 'PENDING', processingNote: 'refund-state-reconciled' },
  );
  assert.deepEqual(
    decideStripeRefundLifecycleMutation({ currentStatus: 'SUCCEEDED', providerStatus: 'FAILED' }),
    { action: 'MUTATE', nextStatus: 'FAILED', processingNote: 'refund-state-reconciled' },
  );
});

test('current provider truth can correct a stale local failed state', () => {
  assert.deepEqual(
    decideStripeRefundLifecycleMutation({ currentStatus: 'FAILED', providerStatus: 'SUCCEEDED' }),
    { action: 'MUTATE', nextStatus: 'SUCCEEDED', processingNote: 'refund-state-reconciled' },
  );
  assert.deepEqual(
    decideStripeRefundLifecycleMutation({ currentStatus: 'FAILED', providerStatus: 'FAILED' }),
    { action: 'KEEP', nextStatus: 'FAILED', processingNote: 'refund-state-unchanged' },
  );
});

test('booking settlement reflects only successful refund money', () => {
  assert.equal(bookingPaymentStatusForRefundLifecycle({
    refundStatus: 'SUCCEEDED',
    baselinePaymentStatus: 'PAID',
    successfulRefundPaymentStatus: 'PARTIALLY_REFUNDED',
  }), 'PARTIALLY_REFUNDED');
  for (const refundStatus of ['PENDING', 'FAILED', 'AMBIGUOUS'] as const) {
    assert.equal(bookingPaymentStatusForRefundLifecycle({
      refundStatus,
      baselinePaymentStatus: 'PAID',
      successfulRefundPaymentStatus: 'PARTIALLY_REFUNDED',
    }), 'PAID');
  }
});
