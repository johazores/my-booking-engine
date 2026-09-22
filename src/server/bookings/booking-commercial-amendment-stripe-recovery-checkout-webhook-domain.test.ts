import assert from 'node:assert/strict';
import test from 'node:test';

import { parseStripeCommercialAmendmentRecoveryCheckoutWebhook } from './booking-commercial-amendment-stripe-recovery-checkout-webhook-domain.ts';

const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
const amendmentId = '33333333-3333-4333-8333-333333333333';
const expiresAt = 1788431800;

function payload(metadata: Record<string, string>, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt_recovery_checkout_123',
    type: overrides.type ?? 'checkout.session.completed',
    created: 1788430000,
    data: {
      object: {
        id: 'cs_test_recovery_123',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 2500,
        currency: 'usd',
        payment_intent: 'pi_recovery_123',
        mode: 'payment',
        client_reference_id: bookingId,
        expires_at: expiresAt,
        metadata,
        ...overrides,
      },
    },
  });
}

const recoveryMetadata = {
  sf_organization_id: organizationId,
  sf_booking_id: bookingId,
  sf_commercial_amendment_id: amendmentId,
  sf_checkout_purpose: 'commercial-amendment-recovery',
};

test('parses exact recovery Checkout ownership and money', () => {
  const evidence = parseStripeCommercialAmendmentRecoveryCheckoutWebhook(payload(recoveryMetadata));
  assert.ok(evidence);
  assert.equal(evidence.organizationId, organizationId);
  assert.equal(evidence.bookingId, bookingId);
  assert.equal(evidence.amendmentId, amendmentId);
  assert.equal(evidence.amountMinor, 2500n);
  assert.equal(evidence.paymentIntentReference, 'pi_recovery_123');
  assert.equal(evidence.checkoutExpiresAt.toISOString(), new Date(expiresAt * 1000).toISOString());
});

test('parses exact unpaid Checkout expiry for deterministic failed-claim finalization', () => {
  const evidence = parseStripeCommercialAmendmentRecoveryCheckoutWebhook(payload(recoveryMetadata, {
    type: 'checkout.session.expired',
    status: 'expired',
    payment_status: 'unpaid',
    payment_intent: null,
  }));
  assert.ok(evidence);
  assert.equal(evidence.eventType, 'checkout.session.expired');
  assert.equal(evidence.checkoutStatus, 'expired');
  assert.equal(evidence.paymentStatus, 'unpaid');
  assert.equal(evidence.paymentIntentReference, null);
});

test('preserves expired Checkout with a PaymentIntent as provider-recovery evidence', () => {
  const evidence = parseStripeCommercialAmendmentRecoveryCheckoutWebhook(payload(recoveryMetadata, {
    type: 'checkout.session.expired',
    status: 'expired',
    payment_status: 'unpaid',
    payment_intent: 'pi_recovery_pending_123',
  }));
  assert.ok(evidence);
  assert.equal(evidence.paymentIntentReference, 'pi_recovery_pending_123');
});

test('ignores normal booking Checkout events', () => {
  const evidence = parseStripeCommercialAmendmentRecoveryCheckoutWebhook(payload({
    sf_organization_id: organizationId,
    sf_booking_id: bookingId,
  }));
  assert.equal(evidence, null);
});

test('refuses malformed commercial amendment ownership metadata', () => {
  const evidence = parseStripeCommercialAmendmentRecoveryCheckoutWebhook(payload({
    sf_organization_id: organizationId,
    sf_booking_id: bookingId,
    sf_commercial_amendment_id: 'not-an-amendment',
    sf_checkout_purpose: 'commercial-amendment-recovery',
  }));
  assert.equal(evidence, null);
});

test('refuses recovery Checkout webhook authority with mode, client reference, or expiry drift', () => {
  assert.equal(parseStripeCommercialAmendmentRecoveryCheckoutWebhook(payload(recoveryMetadata, { mode: 'subscription' })), null);
  assert.equal(parseStripeCommercialAmendmentRecoveryCheckoutWebhook(payload(recoveryMetadata, { client_reference_id: amendmentId })), null);
  assert.equal(parseStripeCommercialAmendmentRecoveryCheckoutWebhook(payload(recoveryMetadata, { expires_at: null })), null);
});
