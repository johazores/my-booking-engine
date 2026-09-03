import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_IDEMPOTENCY_PREFIX,
  hospitalityCommercialAmendmentCheckoutAttemptRequestKey,
  reconcileStripeCommercialAmendmentCheckoutSnapshot,
  stripeCommercialAmendmentCheckoutFingerprint,
  stripeCommercialAmendmentCheckoutIdempotencyKey,
} from './booking-commercial-amendment-stripe-checkout-domain.ts';

const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
const amendmentId = '33333333-3333-4333-8333-333333333333';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    providerCode: 'stripe' as const,
    sessionReference: 'cs_test_change_123',
    status: 'complete' as const,
    paymentStatus: 'paid' as const,
    paymentIntentReference: 'pi_change_123',
    money: { currency: 'USD', amountMinor: 2500n },
    organizationId,
    bookingId,
    commercialAmendmentId: amendmentId,
    purpose: 'commercial-amendment-charge',
    ...overrides,
  };
}

test('creates tenant-bound deterministic Checkout operation identity', () => {
  const first = stripeCommercialAmendmentCheckoutIdempotencyKey({ organizationId, bookingId, amendmentId, requestKey: 'attempt-1' });
  const second = stripeCommercialAmendmentCheckoutIdempotencyKey({ organizationId, bookingId, amendmentId, requestKey: 'attempt-1' });
  assert.equal(first, second);
  assert.match(first, new RegExp(`^${STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_IDEMPOTENCY_PREFIX}[a-f0-9]{64}$`));
  assert.notEqual(first, stripeCommercialAmendmentCheckoutIdempotencyKey({ organizationId: '44444444-4444-4444-8444-444444444444', bookingId, amendmentId, requestKey: 'attempt-1' }));
});

test('fingerprint binds exact amendment money without exposing customer transport input', () => {
  const first = stripeCommercialAmendmentCheckoutFingerprint({ bookingId, amendmentId, currency: 'USD', amountMinor: 2500n });
  const second = stripeCommercialAmendmentCheckoutFingerprint({ bookingId, amendmentId, currency: 'USD', amountMinor: 2501n });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

test('derives a fresh deterministic request key only after definitive failed attempts', () => {
  assert.equal(hospitalityCommercialAmendmentCheckoutAttemptRequestKey(0), 'customer-authorized-attempt-1');
  assert.equal(hospitalityCommercialAmendmentCheckoutAttemptRequestKey(2), 'customer-authorized-attempt-3');
  assert.throws(() => hospitalityCommercialAmendmentCheckoutAttemptRequestKey(-1), /attempt count/);
});

test('accepts exact paid Checkout provider truth', () => {
  const result = reconcileStripeCommercialAmendmentCheckoutSnapshot({
    organizationId, bookingId, amendmentId, checkoutReference: 'cs_test_change_123', currency: 'USD', amountMinor: 2500n, snapshot: snapshot(),
  });
  assert.deepEqual(result, {
    transactionStatus: 'SUCCEEDED', state: 'PAID', checkoutReference: 'cs_test_change_123', paymentIntentReference: 'pi_change_123',
  });
});

test('treats an unpaid expired Session as a definitive failed attempt', () => {
  const result = reconcileStripeCommercialAmendmentCheckoutSnapshot({
    organizationId, bookingId, amendmentId, checkoutReference: 'cs_test_change_123', currency: 'USD', amountMinor: 2500n,
    snapshot: snapshot({ status: 'expired', paymentStatus: 'unpaid', paymentIntentReference: null }),
  });
  assert.equal(result.transactionStatus, 'FAILED');
  assert.equal(result.state, 'EXPIRED');
});

test('fails closed on tenant, purpose, or money drift', () => {
  for (const changed of [
    snapshot({ organizationId: '44444444-4444-4444-8444-444444444444' }),
    snapshot({ purpose: 'commercial-amendment-recovery' }),
    snapshot({ money: { currency: 'USD', amountMinor: 2499n } }),
  ]) {
    assert.throws(() => reconcileStripeCommercialAmendmentCheckoutSnapshot({
      organizationId, bookingId, amendmentId, checkoutReference: 'cs_test_change_123', currency: 'USD', amountMinor: 2500n, snapshot: changed,
    }), /does not match/);
  }
});
