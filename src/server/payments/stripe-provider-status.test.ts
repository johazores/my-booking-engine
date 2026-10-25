import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isKnownStripePaymentIntentStatus, isKnownStripeRefundStatus,
  stripePaymentIntentStatuses, stripeRefundStatuses,
} from './stripe-provider-status.ts';

test('Stripe payment and refund status authority is explicit and case-sensitive', () => {
  for (const status of stripePaymentIntentStatuses) assert.equal(isKnownStripePaymentIntentStatus(status), true);
  for (const status of stripeRefundStatuses) assert.equal(isKnownStripeRefundStatus(status), true);
  for (const value of [undefined, null, 1, {}, '', 'unknown', 'paid', 'SUCCEEDED', ' pending ']) {
    assert.equal(isKnownStripePaymentIntentStatus(value), false);
    assert.equal(isKnownStripeRefundStatus(value), false);
  }
  assert.equal(isKnownStripePaymentIntentStatus('requires_capture'), true);
  assert.equal(isKnownStripeRefundStatus('requires_action'), true);
  assert.equal(isKnownStripeRefundStatus('requires_capture'), false);
});
