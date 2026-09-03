import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX,
  isStripeCheckoutSessionReference,
  stripeCommercialAmendmentRecoveryCheckoutFingerprint,
  stripeCommercialAmendmentRecoveryCheckoutIdempotencyKey,
} from './booking-commercial-amendment-stripe-recovery-checkout-domain.ts';

const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
const amendmentId = '33333333-3333-4333-8333-333333333333';

test('derives stable tenant-bound Checkout operation identity', () => {
  const first = stripeCommercialAmendmentRecoveryCheckoutIdempotencyKey({ organizationId, bookingId, amendmentId, requestKey: 'customer-recovery-request-1' });
  const same = stripeCommercialAmendmentRecoveryCheckoutIdempotencyKey({ organizationId, bookingId, amendmentId, requestKey: 'customer-recovery-request-1' });
  const otherTenant = stripeCommercialAmendmentRecoveryCheckoutIdempotencyKey({ organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', bookingId, amendmentId, requestKey: 'customer-recovery-request-1' });
  assert.equal(first, same);
  assert.notEqual(first, otherTenant);
  assert.ok(first.startsWith(STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX));
  assert.ok(first.length <= 120);
});

test('fingerprint binds the exact amendment recovery money', () => {
  const first = stripeCommercialAmendmentRecoveryCheckoutFingerprint({ bookingId, amendmentId, currency: 'USD', amountMinor: 2500n });
  const changedMoney = stripeCommercialAmendmentRecoveryCheckoutFingerprint({ bookingId, amendmentId, currency: 'USD', amountMinor: 2501n });
  const changedAmendment = stripeCommercialAmendmentRecoveryCheckoutFingerprint({ bookingId, amendmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', currency: 'USD', amountMinor: 2500n });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, changedMoney);
  assert.notEqual(first, changedAmendment);
});

test('recognizes only Stripe Checkout Session references', () => {
  assert.equal(isStripeCheckoutSessionReference('cs_test_recovery_123'), true);
  assert.equal(isStripeCheckoutSessionReference('pi_recovery_123'), false);
  assert.equal(isStripeCheckoutSessionReference('sf_claim_deadbeef'), false);
});
