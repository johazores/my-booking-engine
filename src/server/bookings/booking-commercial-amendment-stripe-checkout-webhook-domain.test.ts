import assert from 'node:assert/strict';
import test from 'node:test';

import { parseStripeCommercialAmendmentCheckoutWebhook } from './booking-commercial-amendment-stripe-checkout-webhook-domain.ts';

const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
const amendmentId = '33333333-3333-4333-8333-333333333333';

function payload(metadata: Record<string, string>, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt_change_checkout_123',
    type: overrides.type ?? 'checkout.session.completed',
    created: 1788430000,
    data: {
      object: {
        id: 'cs_test_change_123',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 2500,
        currency: 'usd',
        payment_intent: 'pi_change_123',
        metadata,
        ...overrides,
      },
    },
  });
}

const amendmentMetadata = {
  sf_organization_id: organizationId,
  sf_booking_id: bookingId,
  sf_commercial_amendment_id: amendmentId,
  sf_checkout_purpose: 'commercial-amendment-charge',
};

test('parses exact normal commercial amendment Checkout ownership and money', () => {
  const evidence = parseStripeCommercialAmendmentCheckoutWebhook(payload(amendmentMetadata));
  assert.ok(evidence);
  assert.equal(evidence.organizationId, organizationId);
  assert.equal(evidence.bookingId, bookingId);
  assert.equal(evidence.amendmentId, amendmentId);
  assert.equal(evidence.amountMinor, 2500n);
  assert.equal(evidence.paymentIntentReference, 'pi_change_123');
});

test('parses unpaid Checkout expiry without turning it into payment evidence', () => {
  const evidence = parseStripeCommercialAmendmentCheckoutWebhook(payload(amendmentMetadata, {
    type: 'checkout.session.expired',
    status: 'expired',
    payment_status: 'unpaid',
    payment_intent: null,
  }));
  assert.ok(evidence);
  assert.equal(evidence.eventType, 'checkout.session.expired');
  assert.equal(evidence.paymentIntentReference, null);
});

test('ignores recovery and normal booking Checkout events', () => {
  assert.equal(parseStripeCommercialAmendmentCheckoutWebhook(payload({
    ...amendmentMetadata,
    sf_checkout_purpose: 'commercial-amendment-recovery',
  })), null);
  assert.equal(parseStripeCommercialAmendmentCheckoutWebhook(payload({
    sf_organization_id: organizationId,
    sf_booking_id: bookingId,
  })), null);
});

test('refuses malformed commercial amendment ownership metadata', () => {
  assert.equal(parseStripeCommercialAmendmentCheckoutWebhook(payload({
    ...amendmentMetadata,
    sf_commercial_amendment_id: 'not-an-amendment',
  })), null);
});
