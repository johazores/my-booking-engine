import assert from 'node:assert/strict';
import test from 'node:test';

import { StripeCheckoutProvider } from '../payments/stripe-checkout-provider.ts';

const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
const amendmentId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-09-03T10:00:00.000Z');

test('normal commercial amendment Checkout carries explicit amendment ownership metadata', async () => {
  let capturedBody = '';
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({
        id: 'cs_test_change_123',
        object: 'checkout.session',
        url: 'https://checkout.stripe.com/c/pay/cs_test_change_123',
        expires_at: Math.floor(now.getTime() / 1000) + 1800,
        amount_total: 2500,
        currency: 'usd',
      }), { status: 200 });
    },
  });

  await provider.createPaymentSession({
    organizationId,
    bookingId,
    commercialAmendmentId: amendmentId,
    purpose: 'commercial-amendment-charge',
    idempotencyKey: 'ca-stripe-checkout-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    money: { currency: 'USD', amountMinor: 2500n },
    successUrl: 'https://booking.example.test/change/success',
    cancelUrl: 'https://booking.example.test/change/cancel',
    now,
  });

  const form = new URLSearchParams(capturedBody);
  assert.equal(form.get('metadata[sf_checkout_purpose]'), 'commercial-amendment-charge');
  assert.equal(form.get('metadata[sf_commercial_amendment_id]'), amendmentId);
  assert.equal(form.get('payment_intent_data[metadata][sf_checkout_purpose]'), 'commercial-amendment-charge');
  assert.equal(form.get('payment_intent_data[metadata][sf_commercial_amendment_id]'), amendmentId);
  assert.equal(form.get('line_items[0][price_data][product_data][name]'), 'Reservation change payment');
});
