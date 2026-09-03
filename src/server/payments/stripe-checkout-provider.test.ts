import assert from 'node:assert/strict';
import test from 'node:test';

import { PaymentProviderError } from './payment-provider.ts';
import { StripeCheckoutProvider } from './stripe-checkout-provider.ts';

const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
const amendmentId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-09-02T09:00:00.000Z');

function checkoutResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_abc123',
    object: 'checkout.session',
    url: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
    expires_at: Math.floor(now.getTime() / 1000) + 1800,
    amount_total: 12500,
    currency: 'usd',
    ...overrides,
  };
}

test('creates hosted Checkout using authoritative money, tenant metadata, and Stripe idempotency', async () => {
  let capturedBody = '';
  let capturedIdempotency = '';
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      capturedIdempotency = new Headers(init?.headers).get('Idempotency-Key') ?? '';
      return new Response(JSON.stringify(checkoutResponse()), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await provider.createPaymentSession({
    organizationId,
    bookingId,
    idempotencyKey: 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    money: { currency: 'USD', amountMinor: 12500n },
    successUrl: 'https://booking.example.test/book/acme?payment=processing',
    cancelUrl: 'https://booking.example.test/book/acme?payment=cancelled',
    customerEmail: 'guest@example.test',
    now,
  });

  const form = new URLSearchParams(capturedBody);
  assert.equal(form.get('mode'), 'payment');
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '12500');
  assert.equal(form.get('line_items[0][price_data][currency]'), 'usd');
  assert.equal(form.get('payment_intent_data[metadata][sf_organization_id]'), organizationId);
  assert.equal(form.get('payment_intent_data[metadata][sf_booking_id]'), bookingId);
  assert.equal(form.get('customer_email'), 'guest@example.test');
  assert.equal(form.has('card[number]'), false);
  assert.match(capturedIdempotency, /^public:[0-9a-f]{64}$/);
  assert.equal(result.money.amountMinor, 12500n);
  assert.equal(result.money.currency, 'USD');
  assert.equal(result.expiresAt.toISOString(), '2026-09-02T09:30:00.000Z');
});

test('creates amendment recovery Checkout with explicit Session and PaymentIntent ownership metadata', async () => {
  let capturedBody = '';
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify(checkoutResponse({ amount_total: 2500 })), { status: 200 });
    },
  });

  await provider.createPaymentSession({
    organizationId,
    bookingId,
    commercialAmendmentId: amendmentId,
    purpose: 'commercial-amendment-recovery',
    idempotencyKey: 'ca-stripe-customer-checkout-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    money: { currency: 'USD', amountMinor: 2500n },
    successUrl: 'https://booking.example.test/recovery/success',
    cancelUrl: 'https://booking.example.test/recovery/cancel',
    now,
  });

  const form = new URLSearchParams(capturedBody);
  assert.equal(form.get('metadata[sf_checkout_purpose]'), 'commercial-amendment-recovery');
  assert.equal(form.get('metadata[sf_commercial_amendment_id]'), amendmentId);
  assert.equal(form.get('payment_intent_data[metadata][sf_checkout_purpose]'), 'commercial-amendment-recovery');
  assert.equal(form.get('payment_intent_data[metadata][sf_commercial_amendment_id]'), amendmentId);
  assert.equal(form.get('line_items[0][price_data][product_data][name]'), 'Reservation recovery payment');
});

test('retrieves exact Checkout provider truth for amendment recovery reconciliation', async () => {
  let capturedUrl = '';
  let capturedMethod = '';
  let capturedAuthorization = '';
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedMethod = init?.method ?? '';
      capturedAuthorization = new Headers(init?.headers).get('Authorization') ?? '';
      return new Response(JSON.stringify(checkoutResponse({
        status: 'complete',
        payment_status: 'paid',
        payment_intent: 'pi_recovery_123',
        amount_total: 2500,
        metadata: {
          sf_organization_id: organizationId,
          sf_booking_id: bookingId,
          sf_commercial_amendment_id: amendmentId,
          sf_checkout_purpose: 'commercial-amendment-recovery',
        },
      })), { status: 200 });
    },
  });

  const snapshot = await provider.retrievePaymentSession('cs_test_abc123');
  assert.equal(capturedUrl, 'https://api.stripe.com/v1/checkout/sessions/cs_test_abc123');
  assert.equal(capturedMethod, 'GET');
  assert.equal(capturedAuthorization, 'Bearer sk_test_checkout_secret');
  assert.equal(snapshot.sessionReference, 'cs_test_abc123');
  assert.equal(snapshot.status, 'complete');
  assert.equal(snapshot.paymentStatus, 'paid');
  assert.equal(snapshot.paymentIntentReference, 'pi_recovery_123');
  assert.equal(snapshot.money.currency, 'USD');
  assert.equal(snapshot.money.amountMinor, 2500n);
  assert.equal(snapshot.organizationId, organizationId);
  assert.equal(snapshot.bookingId, bookingId);
  assert.equal(snapshot.commercialAmendmentId, amendmentId);
  assert.equal(snapshot.purpose, 'commercial-amendment-recovery');
});

test('fails closed when retrieved Checkout provider identity is malformed', async () => {
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async () => new Response(JSON.stringify(checkoutResponse({
      status: 'complete',
      payment_status: 'paid',
      payment_intent: 'not-a-payment-intent',
      metadata: {},
    })), { status: 200 }),
  });

  await assert.rejects(
    provider.retrievePaymentSession('cs_test_abc123'),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
  );
});

test('rejects amendment metadata on a normal booking Checkout', async () => {
  const provider = new StripeCheckoutProvider({ secretKey: 'sk_test_checkout_secret' });
  await assert.rejects(
    provider.createPaymentSession({
      organizationId,
      bookingId,
      commercialAmendmentId: amendmentId,
      idempotencyKey: 'public:3123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      money: { currency: 'USD', amountMinor: 12500n },
      successUrl: 'https://booking.example.test/success',
      cancelUrl: 'https://booking.example.test/cancel',
      now,
    }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST',
  );
});

test('rejects provider money drift instead of redirecting the customer', async () => {
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async () => new Response(JSON.stringify(checkoutResponse({ amount_total: 12499 })), { status: 200 }),
  });

  await assert.rejects(
    provider.createPaymentSession({
      organizationId,
      bookingId,
      idempotencyKey: 'public:1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      money: { currency: 'USD', amountMinor: 12500n },
      successUrl: 'https://booking.example.test/success',
      cancelUrl: 'https://booking.example.test/cancel',
      now,
    }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
  );
});

test('maps Stripe rate limits to retryable provider errors', async () => {
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429 }),
  });

  await assert.rejects(
    provider.createPaymentSession({
      organizationId,
      bookingId,
      idempotencyKey: 'public:2123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      money: { currency: 'USD', amountMinor: 12500n },
      successUrl: 'https://booking.example.test/success',
      cancelUrl: 'https://booking.example.test/cancel',
      now,
    }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'RATE_LIMITED' && error.retryable,
  );
});
