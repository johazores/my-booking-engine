import assert from 'node:assert/strict';
import test from 'node:test';

import { PaymentProviderError } from './payment-provider.ts';
import { StripeCheckoutProvider } from './stripe-checkout-provider.ts';

const organizationId = 'a1111111-1111-4111-8111-111111111111';
const bookingId = 'b2222222-2222-4222-8222-222222222222';
const amendmentId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-09-02T09:00:00.000Z');

function checkoutResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_abc123',
    object: 'checkout.session',
    mode: 'payment',
    ui_mode: 'hosted_page',
    status: 'open',
    payment_status: 'unpaid',
    success_url: 'https://booking.example.test/success',
    cancel_url: 'https://booking.example.test/cancel',
    client_reference_id: bookingId,
    metadata: {
      sf_organization_id: organizationId,
      sf_booking_id: bookingId,
    },
    url: 'https://checkout.stripe.com/c/pay/cs_test_abc123#checkout',
    expires_at: Math.floor(now.getTime() / 1000) + 1980,
    amount_total: 12500,
    currency: 'usd',
    ...overrides,
  };
}

async function createBookingCheckout(overrides: Record<string, unknown>) {
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async () => new Response(JSON.stringify(checkoutResponse({
      success_url: 'https://booking.example.test/book/acme?payment=processing',
      cancel_url: 'https://booking.example.test/book/acme?payment=cancelled',
      ...overrides,
    })), { status: 200 }),
  });
  return provider.createPaymentSession({
    organizationId,
    bookingId,
    idempotencyKey: 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    money: { currency: 'USD', amountMinor: 12500n },
    successUrl: 'https://booking.example.test/book/acme?payment=processing',
    cancelUrl: 'https://booking.example.test/book/acme?payment=cancelled',
    now,
  });
}

test('creates hosted Checkout using authoritative money, tenant metadata, and Stripe idempotency', async () => {
  let capturedBody = '';
  let capturedIdempotency = '';
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      capturedIdempotency = new Headers(init?.headers).get('Idempotency-Key') ?? '';
      return new Response(JSON.stringify(checkoutResponse({
        success_url: 'https://booking.example.test/book/acme?payment=processing',
        cancel_url: 'https://booking.example.test/book/acme?payment=cancelled',
      })), { status: 200, headers: { 'content-type': 'application/json' } });
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
  assert.equal(form.get('ui_mode'), 'hosted_page');
  assert.equal(form.get('expires_at'), String(Math.floor(now.getTime() / 1000) + 33 * 60));
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '12500');
  assert.equal(form.get('line_items[0][price_data][currency]'), 'usd');
  assert.equal(form.get('payment_intent_data[metadata][sf_organization_id]'), organizationId);
  assert.equal(form.get('payment_intent_data[metadata][sf_booking_id]'), bookingId);
  assert.equal(form.get('customer_email'), 'guest@example.test');
  assert.equal(form.get('success_url'), 'https://booking.example.test/book/acme?payment=processing');
  assert.equal(form.get('cancel_url'), 'https://booking.example.test/book/acme?payment=cancelled');
  assert.equal(form.has('card[number]'), false);
  assert.match(capturedIdempotency, /^public:[0-9a-f]{64}$/);
  assert.equal(result.money.amountMinor, 12500n);
  assert.equal(result.money.currency, 'USD');
  assert.equal(result.expiresAt.toISOString(), '2026-09-02T09:33:00.000Z');
  assert.equal(result.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_abc123#checkout');
});

test('rejects Checkout redirect authority outside the default Stripe-hosted session URL', async () => {
  for (const url of [
    'https://example.test/c/pay/cs_test_abc123',
    'https://pay.example.test/c/pay/cs_test_abc123',
    'https://checkout.stripe.com.evil.test/c/pay/cs_test_abc123',
    'https://checkout.stripe.com/c/pay/cs_test_other',
    'https://checkout.stripe.com/c/pay/%63s_test_abc123',
  ]) {
    await assert.rejects(
      createBookingCheckout({ url }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
});

test('rejects alternate or parser-normalized Stripe paths even when the final Session ID matches', async () => {
  for (const url of [
    'https://checkout.stripe.com/redirect/cs_test_abc123',
    'https://checkout.stripe.com/c/pay//cs_test_abc123',
    'https://checkout.stripe.com/c/pay/cs_test_abc123/',
    'https://checkout.stripe.com/c/pay/cs_test_abc123/../cs_test_abc123',
    'https://checkout.stripe.com/c/pay/../pay/cs_test_abc123',
    'https://checkout.stripe.com/c/pay/%2e%2e/pay/cs_test_abc123',
    'https://checkout.stripe.com/c/pay/cs_test_abc123x',
    'https://checkout.stripe.com:443/c/pay/cs_test_abc123',
    'https://CHECKOUT.STRIPE.COM/c/pay/cs_test_abc123',
  ]) {
    await assert.rejects(
      createBookingCheckout({ url }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
});

test('accepts the exact default hosted Checkout path with Stripe URL fragments', async () => {
  const session = await createBookingCheckout({
    url: 'https://checkout.stripe.com/c/pay/cs_test_abc123#checkout',
  });
  assert.equal(session.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_abc123#checkout');
});

test('rejects raw Checkout redirect text that URL parsing would silently change', async () => {
  const validUrl = 'https://checkout.stripe.com/c/pay/cs_test_abc123#checkout';
  for (const url of [
    ` ${validUrl}`,
    `${validUrl} `,
    `${validUrl}\n`,
    `${validUrl}\r`,
    `${validUrl}\t`,
    `${validUrl}\u0000`,
    `${validUrl}\u0085`,
    `${validUrl}\ud800`,
    `${validUrl}\udc00`,
    `${validUrl}${'x'.repeat(4_096)}`,
  ]) {
    await assert.rejects(
      createBookingCheckout({ url }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
});

test('rejects Checkout URL query and fragment text repaired by URL parsing', async () => {
  const base = 'https://checkout.stripe.com/c/pay/cs_test_abc123';
  for (const suffix of [
    '?state=needs encoding',
    '#checkout token',
    '#☃',
    '?customer=josé',
    '#<script>',
    '#checkout`token',
  ]) {
    await assert.rejects(
      createBookingCheckout({ url: base + suffix }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
      suffix,
    );
  }
});

test('preserves canonical encoded Checkout query and fragment evidence exactly', async () => {
  const url = 'https://checkout.stripe.com/c/pay/cs_test_abc123?token=abc%20def#checkout%20token';
  const session = await createBookingCheckout({ url });
  assert.equal(session.checkoutUrl, url);
});

test('accepts an otherwise authoritative hosted Session when optional ui_mode is omitted', async () => {
  const session = await createBookingCheckout({ ui_mode: undefined });
  assert.equal(session.sessionReference, 'cs_test_abc123');
  assert.equal(session.money.amountMinor, 12500n);
});

test('rejects created Checkout Session ownership, readiness, redirects, metadata, or expiry drift', async () => {
  const cases: Record<string, unknown>[] = [
    { mode: 'subscription' },
    { ui_mode: 'hosted' },
    { ui_mode: 'embedded_page' },
    { ui_mode: 'elements' },
    { ui_mode: 'form' },
    { ui_mode: 'custom' },
    { ui_mode: null },
    { status: 'complete' },
    { status: 'expired' },
    { status: null },
    { status: undefined },
    { payment_status: 'paid' },
    { payment_status: 'no_payment_required' },
    { payment_status: null },
    { payment_status: undefined },
    { success_url: 'https://other.example.test/book/acme?payment=processing' },
    { success_url: null },
    { success_url: undefined },
    { cancel_url: 'https://other.example.test/book/acme?payment=cancelled' },
    { cancel_url: null },
    { cancel_url: undefined },
    { client_reference_id: amendmentId },
    { metadata: { sf_organization_id: amendmentId, sf_booking_id: bookingId } },
    { metadata: { sf_organization_id: organizationId, sf_booking_id: amendmentId } },
    { metadata: { sf_organization_id: ` ${organizationId}`, sf_booking_id: bookingId } },
    { metadata: { sf_organization_id: organizationId, sf_booking_id: `${bookingId} ` } },
    { client_reference_id: ` ${bookingId}` },
    { metadata: { sf_organization_id: organizationId, sf_booking_id: bookingId, sf_checkout_purpose: 'commercial-amendment-charge' } },
    { metadata: { sf_organization_id: organizationId, sf_booking_id: bookingId, sf_checkout_purpose: ' ' } },
    { metadata: { sf_organization_id: organizationId, sf_booking_id: bookingId, sf_checkout_purpose: '' } },
    { metadata: { sf_organization_id: organizationId, sf_booking_id: bookingId, sf_commercial_amendment_id: '' } },
    { expires_at: Math.floor(now.getTime() / 1000) + 1981 },
  ];
  for (const overrides of cases) {
    await assert.rejects(
      createBookingCheckout(overrides),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
});

test('creates amendment recovery Checkout with explicit Session and PaymentIntent ownership metadata', async () => {
  let capturedBody = '';
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify(checkoutResponse({
        amount_total: 2500,
        success_url: 'https://booking.example.test/recovery/success',
        cancel_url: 'https://booking.example.test/recovery/cancel',
        metadata: {
          sf_organization_id: organizationId,
          sf_booking_id: bookingId,
          sf_checkout_purpose: 'commercial-amendment-recovery',
          sf_commercial_amendment_id: amendmentId,
        },
      })), { status: 200 });
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

test('rejects retrieved Checkout authority that no longer belongs to the persisted booking operation', async () => {
  const cases: Record<string, unknown>[] = [
    { mode: 'subscription' },
    { ui_mode: 'hosted' },
    { ui_mode: 'embedded_page' },
    { ui_mode: 'elements' },
    { ui_mode: 'form' },
    { ui_mode: null },
    { client_reference_id: amendmentId },
    { client_reference_id: null },
    { client_reference_id: `${bookingId} ` },
    { metadata: { sf_organization_id: organizationId, sf_booking_id: ` ${bookingId}` } },
    { metadata: { sf_organization_id: organizationId, sf_booking_id: bookingId, sf_commercial_amendment_id: ` ${amendmentId}` } },
    { metadata: { sf_organization_id: organizationId, sf_booking_id: bookingId, sf_checkout_purpose: ' commercial-amendment-recovery' } },
    { expires_at: null },
    { expires_at: -1 },
    { expires_at: 12.5 },
  ];
  for (const overrides of cases) {
    const provider = new StripeCheckoutProvider({
      secretKey: 'sk_test_checkout_secret',
      fetchImpl: async () => new Response(JSON.stringify(checkoutResponse({
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
        ...overrides,
      })), { status: 200 }),
    });
    await assert.rejects(
      provider.retrievePaymentSession('cs_test_abc123'),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
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

test('Checkout creation preserves ambiguous Stripe conflicts and external-dependency failures', async () => {
  for (const item of [
    { status: 409, body: { error: { code: 'idempotency_key_in_use' } }, code: 'UNKNOWN' },
    { status: 424, body: { error: { type: 'card_error' } }, code: 'PROVIDER_UNAVAILABLE' },
    { status: 402, body: { error: { message: 'Unclassified failure' } }, code: 'UNKNOWN' },
    { status: 402, body: { error: { type: 'card_error' } }, code: 'UNKNOWN' },
    { status: 402, body: { error: { type: 'card_error', decline_code: ' ' } }, code: 'UNKNOWN' },
    { status: 400, body: { error: { type: 'api_error' } }, code: 'UNKNOWN' },
    { status: 402, body: { error: { type: 'card_error', code: 'authentication_required' } }, code: 'UNKNOWN' },
    { status: 402, body: { error: { decline_code: 'authentication_required' } }, code: 'UNKNOWN' },
    { status: 402, body: { error: { code: 'card_declined' } }, code: 'UNKNOWN' },
    { status: 402, body: { error: { decline_code: 'generic_decline' } }, code: 'UNKNOWN' },
    { status: 400, body: { error: { type: 'idempotency_error' } }, code: 'UNKNOWN' },
    { status: 409, body: { error: { type: 'idempotency_error', code: 'future_code' } }, code: 'UNKNOWN' },
    { status: 402, body: { error: { type: 'idempotency_error', code: 'idempotency_key_reused' } }, code: 'UNKNOWN' },
    { status: 402, body: { error: { type: 'card_error', code: 'idempotency_key_reused' } }, code: 'UNKNOWN' },
  ] as const) {
    const provider = new StripeCheckoutProvider({
      secretKey: 'sk_test_checkout_secret',
      fetchImpl: async () => new Response(JSON.stringify(item.body), { status: item.status }),
    });
    await assert.rejects(provider.createPaymentSession({
      organizationId, bookingId,
      idempotencyKey: 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      money: { currency: 'USD', amountMinor: 12500n },
      successUrl: 'https://booking.example.test/success',
      cancelUrl: 'https://booking.example.test/cancel',
      now,
    }), (error: unknown) => error instanceof PaymentProviderError && error.code === item.code && error.retryable);
  }
});

test('Checkout retrieval uses read-only Stripe failure authority, not payment-write idempotency classification', async () => {
  for (const item of [
    { status: 409, body: { error: { type: 'idempotency_error' } }, code: 'UNKNOWN', retryable: true },
    { status: 424, body: { error: { type: 'card_error' } }, code: 'PROVIDER_UNAVAILABLE', retryable: true },
    { status: 402, body: { error: { type: 'card_error' } }, code: 'UNKNOWN', retryable: true },
    { status: 404, body: { error: { type: 'card_error' } }, code: 'INVALID_REQUEST', retryable: false },
    { status: 400, body: { error: { type: 'api_error' } }, code: 'UNKNOWN', retryable: true },
  ] as const) {
    const provider = new StripeCheckoutProvider({
      secretKey: 'sk_test_checkout_secret',
      fetchImpl: async () => new Response(JSON.stringify(item.body), { status: item.status }),
    });
    await assert.rejects(provider.retrievePaymentSession('cs_test_abc123'),
      (error: unknown) => error instanceof PaymentProviderError && error.code === item.code && error.retryable === item.retryable);
  }
});

test('created Checkout IDs must fit the persisted provider reference limit', async () => {
  await assert.rejects(
    createBookingCheckout({ id: `cs_${'x'.repeat(158)}` }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
  );
  const provider = new StripeCheckoutProvider({ secretKey: 'sk_test_checkout_secret' });
  await assert.rejects(
    provider.retrievePaymentSession(`cs_${'x'.repeat(158)}`),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST',
  );
});

test('Stripe Checkout creation and retrieval reject invalid provider currencies', async () => {
  for (const currency of [null, 'zzz', 'USD', ' usd ', 123]) {
    await assert.rejects(createBookingCheckout({ currency }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable);
    const provider = new StripeCheckoutProvider({
      secretKey: 'sk_test_checkout_secret',
      fetchImpl: async () => new Response(JSON.stringify(checkoutResponse({
        currency, status: 'complete', payment_status: 'paid', payment_intent: 'pi_checkout_currency_1',
      }))),
    });
    await assert.rejects(provider.retrievePaymentSession('cs_test_abc123'),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable);
  }
});

test('Stripe Checkout requires a JSON object for successful creation and retrieval', async () => {
  for (const payload of [null, [], 'not-a-session', 123]) {
    const provider = new StripeCheckoutProvider({
      secretKey: 'sk_test_checkout_secret',
      fetchImpl: async () => new Response(JSON.stringify(payload)),
    });
    await assert.rejects(provider.createPaymentSession({
      organizationId, bookingId, idempotencyKey: 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      money: { currency: 'USD', amountMinor: 12500n },
      successUrl: 'https://booking.example.test/success', cancelUrl: 'https://booking.example.test/cancel', now,
    }), (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable);
    await assert.rejects(provider.retrievePaymentSession('cs_test_abc123'),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable);
  }
});

test('Stripe Checkout preserves HTTP error classification for malformed error JSON', async () => {
  for (const [status, code, retryable] of [[429, 'RATE_LIMITED', true], [401, 'AUTHENTICATION_FAILED', false]] as const) {
    for (const payload of [null, [], { error: { message: 7 } }]) {
      const provider = new StripeCheckoutProvider({
        secretKey: 'sk_test_checkout_secret',
        fetchImpl: async () => new Response(JSON.stringify(payload), { status }),
      });
      await assert.rejects(provider.retrievePaymentSession('cs_test_abc123'),
        (error: unknown) => error instanceof PaymentProviderError && error.code === code && error.retryable === retryable);
    }
  }
});

test('Stripe Checkout creation and retrieval preserve retryable HTTP status over error body hints', async () => {
  for (const item of [
    { status: 408, type: 'idempotency_error', code: 'TIMEOUT' },
    { status: 429, type: 'idempotency_error', code: 'RATE_LIMITED' },
    { status: 503, type: 'card_error', code: 'PROVIDER_UNAVAILABLE' },
  ] as const) {
    const provider = new StripeCheckoutProvider({
      secretKey: 'sk_test_checkout_secret',
      fetchImpl: async () => new Response(JSON.stringify({ error: { type: item.type } }), { status: item.status }),
    });
    await assert.rejects(provider.createPaymentSession({
      organizationId, bookingId,
      idempotencyKey: 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      money: { currency: 'USD', amountMinor: 12500n },
      successUrl: 'https://booking.example.test/success',
      cancelUrl: 'https://booking.example.test/cancel',
      now,
    }), (error: unknown) => error instanceof PaymentProviderError && error.code === item.code && error.retryable);
    await assert.rejects(provider.retrievePaymentSession('cs_test_abc123'), (error: unknown) =>
      error instanceof PaymentProviderError && error.code === item.code && error.retryable);
  }
});

test('Checkout creation rejects noncanonical commercial authority before contacting Stripe', async () => {
  const cases: Array<Record<string, unknown>> = [
    { organizationId: ` ${organizationId}` },
    { bookingId: `${bookingId} ` },
    { organizationId: 'A1111111-1111-4111-8111-111111111111' },
    { bookingId: 'B2222222-2222-4222-8222-222222222222' },
    { purpose: 'future-payment-purpose' },
    { commercialAmendmentId: '' },
    { commercialAmendmentId: amendmentId },
    { purpose: 'commercial-amendment-charge' },
    { purpose: 'commercial-amendment-charge', commercialAmendmentId: ` ${amendmentId}` },
    { purpose: 'commercial-amendment-recovery', commercialAmendmentId: `${amendmentId}\n` },
    { purpose: 'commercial-amendment-charge', commercialAmendmentId: 'C3333333-3333-4333-8333-333333333333' },
  ];
  for (const overrides of cases) {
    let calls = 0;
    const provider = new StripeCheckoutProvider({
      secretKey: 'sk_test_checkout_secret',
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(checkoutResponse()));
      },
    });
    await assert.rejects(provider.createPaymentSession({
      organizationId,
      bookingId,
      idempotencyKey: 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      money: { currency: 'USD', amountMinor: 12500n },
      successUrl: 'https://booking.example.test/success',
      cancelUrl: 'https://booking.example.test/cancel',
      now,
      ...overrides,
    }), (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST');
    assert.equal(calls, 0, JSON.stringify(overrides));
  }
});

test('created Checkout requires exact canonical metadata rather than case-normalized UUID identity', async () => {
  const tenant = 'a1111111-1111-4111-8111-111111111111';
  const booking = 'b2222222-2222-4222-8222-222222222222';
  for (const metadata of [
    { sf_organization_id: tenant.toUpperCase(), sf_booking_id: booking },
    { sf_organization_id: tenant, sf_booking_id: booking.toUpperCase() },
  ]) {
    const provider = new StripeCheckoutProvider({
      secretKey: 'sk_test_checkout_secret',
      fetchImpl: async () => new Response(JSON.stringify(checkoutResponse({
        client_reference_id: booking, metadata,
      }))),
    });
    await assert.rejects(provider.createPaymentSession({
      organizationId: tenant, bookingId: booking,
      idempotencyKey: 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      money: { currency: 'USD', amountMinor: 12500n },
      successUrl: 'https://booking.example.test/success',
      cancelUrl: 'https://booking.example.test/cancel',
      now,
    }), (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable);
  }
});

test('retrieved Checkout rejects missing, uppercase, and partial commercial ownership evidence', async () => {
  const tenant = 'a1111111-1111-4111-8111-111111111111';
  const booking = 'b2222222-2222-4222-8222-222222222222';
  const canonical = {
    sf_organization_id: tenant,
    sf_booking_id: booking,
    sf_commercial_amendment_id: amendmentId,
    sf_checkout_purpose: 'commercial-amendment-recovery',
  };
  for (const metadata of [
    { ...canonical, sf_organization_id: undefined },
    { ...canonical, sf_organization_id: tenant.toUpperCase() },
    { ...canonical, sf_booking_id: booking.toUpperCase() },
    { ...canonical, sf_commercial_amendment_id: undefined },
    { ...canonical, sf_checkout_purpose: undefined },
    { ...canonical, sf_checkout_purpose: 'booking-payment' },
  ]) {
    const provider = new StripeCheckoutProvider({
      secretKey: 'sk_test_checkout_secret',
      fetchImpl: async () => new Response(JSON.stringify(checkoutResponse({
        client_reference_id: booking,
        metadata,
        status: 'complete',
        payment_status: 'paid',
        payment_intent: 'pi_checkout_1',
      }))),
    });
    await assert.rejects(provider.retrievePaymentSession('cs_test_abc123'),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable);
  }
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async () => new Response(JSON.stringify(checkoutResponse({
      client_reference_id: booking.toUpperCase(),
      metadata: canonical,
      status: 'complete',
      payment_status: 'paid',
      payment_intent: 'pi_checkout_1',
    }))),
  });
  await assert.rejects(provider.retrievePaymentSession('cs_test_abc123'),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable);
});

test('Checkout snapshots tenant, money, purpose, and idempotency authority before Stripe I/O', async () => {
  const reads: Record<string, number> = {};
  const read = (name: string) => (reads[name] = (reads[name] ?? 0) + 1);
  const key = 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  let form = new URLSearchParams();
  let outboundKey = '';
  let calls = 0;
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async (_url, init) => {
      calls += 1;
      form = new URLSearchParams(String(init?.body ?? ''));
      outboundKey = new Headers(init?.headers).get('Idempotency-Key') ?? '';
      return new Response(JSON.stringify(checkoutResponse()), { status: 200 });
    },
  });
  const input = {
    get organizationId() { return read('organizationId') === 1 ? organizationId : amendmentId; },
    get bookingId() { return read('bookingId') === 1 ? bookingId : amendmentId; },
    get idempotencyKey() { return read('idempotencyKey') === 1 ? key : 'changed-key'; },
    get money() {
      read('money');
      return {
        get currency() { return read('currency') === 1 ? 'USD' : 'EUR'; },
        get amountMinor() { return read('amountMinor') === 1 ? 12500n : 999n; },
      };
    },
    get successUrl() { read('successUrl'); return 'https://booking.example.test/success'; },
    get cancelUrl() { read('cancelUrl'); return 'https://booking.example.test/cancel'; },
    get customerEmail() { read('customerEmail'); return undefined; },
    get now() { read('now'); return now; },
    get purpose() { return read('purpose') === 1 ? undefined : 'commercial-amendment-charge'; },
    get commercialAmendmentId() { read('commercialAmendmentId'); return undefined; },
  };
  const result = await provider.createPaymentSession(input as Parameters<StripeCheckoutProvider['createPaymentSession']>[0]);
  assert.equal(calls, 1);
  assert.equal(outboundKey, key);
  assert.equal(form.get('client_reference_id'), bookingId);
  assert.equal(form.get('metadata[sf_organization_id]'), organizationId);
  assert.equal(form.get('metadata[sf_booking_id]'), bookingId);
  assert.equal(form.get('line_items[0][price_data][currency]'), 'usd');
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '12500');
  assert.equal(form.has('metadata[sf_checkout_purpose]'), false);
  assert.equal(result.money.amountMinor, 12500n);
  for (const name of ['organizationId', 'bookingId', 'idempotencyKey', 'money', 'currency', 'amountMinor', 'successUrl', 'cancelUrl', 'customerEmail', 'now', 'purpose', 'commercialAmendmentId']) {
    assert.equal(reads[name], 1, name);
  }
  let invalidCalls = 0;
  const rejectProvider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async () => { invalidCalls += 1; throw new Error('Getter failure reached Stripe.'); },
  });
  await assert.rejects(
    rejectProvider.createPaymentSession({
      ...input,
      get bookingId(): string { throw new Error('Unsafe booking getter.'); },
    } as Parameters<StripeCheckoutProvider['createPaymentSession']>[0]),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST' && !error.retryable,
  );
  assert.equal(invalidCalls, 0);
});

test('Checkout expiry uses native Date authority and rejects forged clocks before Stripe I/O', async () => {
  const invalidDate = new Date(Number.NaN);
  Object.defineProperty(invalidDate, 'getTime', { value: () => now.getTime() });
  const forgedClock = { getTime: () => now.getTime() };
  let calls = 0;
  const rejectProvider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('Invalid clock must never reach Stripe.');
    },
  });
  const input = {
    organizationId,
    bookingId,
    idempotencyKey: 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    money: { currency: 'USD', amountMinor: 12500n },
    successUrl: 'https://booking.example.test/success',
    cancelUrl: 'https://booking.example.test/cancel',
  };
  for (const suppliedNow of [
    invalidDate,
    forgedClock,
    Object.create(Date.prototype),
    new Proxy(new Date(now.getTime()), {}),
    null,
  ]) {
    await assert.rejects(
      rejectProvider.createPaymentSession({ ...input, now: suppliedNow } as Parameters<StripeCheckoutProvider['createPaymentSession']>[0]),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST' && !error.retryable,
    );
  }
  const throwingClockInput = {
    ...input,
    get now(): Date {
      throw new Error('Clock getter failed.');
    },
  };
  await assert.rejects(
    rejectProvider.createPaymentSession(throwingClockInput),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST' && !error.retryable,
  );
  assert.equal(calls, 0);

  // A real Date remains valid even if its instance getTime is replaced.
  // Neither a forged valid time nor a throwing instance method can change
  // the provider expiry or prevent the canonical Checkout request.
  let requestedExpiry = '';
  const acceptProvider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async (_url, init) => {
      requestedExpiry = new URLSearchParams(String(init?.body ?? '')).get('expires_at') ?? '';
      return new Response(JSON.stringify(checkoutResponse()), { status: 200 });
    },
  });
  const validDateWithForgedGetter = new Date(now.getTime());
  Object.defineProperty(validDateWithForgedGetter, 'getTime', { value: () => 0 });
  const validDateWithThrowingGetter = new Date(now.getTime());
  Object.defineProperty(validDateWithThrowingGetter, 'getTime', { value: () => { throw new Error('Do not call shadowed getTime.'); } });
  for (const validDate of [validDateWithForgedGetter, validDateWithThrowingGetter]) {
    const result = await acceptProvider.createPaymentSession({ ...input, now: validDate });
    assert.equal(requestedExpiry, String(Math.floor(now.getTime() / 1000) + 33 * 60));
    assert.equal(result.expiresAt.toISOString(), '2026-09-02T09:33:00.000Z');
  }
  let clockReads = 0;
  const singleReadClockInput = {
    ...input,
    get now(): Date {
      clockReads += 1;
      if (clockReads > 1) throw new Error('Checkout read the clock twice.');
      return now;
    },
  };
  const session = await acceptProvider.createPaymentSession(singleReadClockInput);
  assert.equal(clockReads, 1);
  assert.equal(session.expiresAt.toISOString(), '2026-09-02T09:33:00.000Z');
});

test('Stripe Checkout rejects malformed commercial write context and clock before provider I/O', async () => {
  assert.notEqual(organizationId.toUpperCase(), organizationId);
  let calls = 0;
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('Invalid Checkout input must never reach Stripe.');
    },
  });
  const valid = {
    organizationId,
    bookingId,
    idempotencyKey: 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    money: { currency: 'USD', amountMinor: 12500n },
    successUrl: 'https://booking.example.test/success',
    cancelUrl: 'https://booking.example.test/cancel',
    now,
  };
  for (const overrides of [
    { organizationId: organizationId.toUpperCase() },
    { bookingId: ` ${bookingId}` },
    { idempotencyKey: ` ${valid.idempotencyKey}` },
    { money: { currency: 'usd', amountMinor: 12500n } },
    { money: { currency: 'USD', amountMinor: 0n } },
    { money: { currency: 'USD', amountMinor: -1n } },
    { money: { currency: 'USD', amountMinor: 12500 } },
    { money: { currency: 'USD', amountMinor: BigInt(Number.MAX_SAFE_INTEGER) + 1n } },
    { now: new Date(Number.NaN) },
    { now: '2026-09-02T09:00:00.000Z' },
  ]) {
    await assert.rejects(
      provider.createPaymentSession({ ...valid, ...overrides } as Parameters<StripeCheckoutProvider['createPaymentSession']>[0]),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST' && !error.retryable,
    );
  }
  assert.equal(calls, 0);
});

test('Checkout rejects malformed customer email, return URLs, and explicit null authority before Stripe I/O', async () => {
  let calls = 0;
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('Invalid Checkout input must never reach Stripe.');
    },
  });
  const valid = {
    organizationId,
    bookingId,
    idempotencyKey: 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    money: { currency: 'USD', amountMinor: 12500n },
    successUrl: 'https://booking.example.test/success',
    cancelUrl: 'https://booking.example.test/cancel',
    now,
  };
  for (const overrides of [
    { customerEmail: '' },
    { customerEmail: ' guest@example.test' },
    { customerEmail: 'guest@example.test ' },
    { customerEmail: 'guest@example.test\n' },
    { customerEmail: 'guest@@example.test' },
    { customerEmail: 'guest@example' },
    { customerEmail: 'guest@example.test\u007f' },
    { customerEmail: 'guest@example.test\ud800' },
    { customerEmail: 'a'.repeat(310) + '@example.test' },
    { customerEmail: 42 },
    { customerEmail: ['guest@example.test'] },
    { successUrl: 'https://booking.example.test/success\n' },
    { successUrl: 'https://booking.example.test/success\ud800' },
    { cancelUrl: 'https://booking.example.test/cancel\r' },
    { successUrl: ' https://booking.example.test/success' },
    { cancelUrl: 'https://booking.example.test/cancel ' },
    { successUrl: 'http://booking.example.test/success' },
    { cancelUrl: 'https://user:pass@booking.example.test/cancel' },
    { successUrl: 'https://booking.example.test/' + 'x'.repeat(2_050) },
    { cancelUrl: 42 },
    { successUrl: 'https://BOOKING.example.test/success' },
    { cancelUrl: 'https://booking.example.test:443/cancel' },
    { successUrl: 'https://booking.example.test/a/../success' },
    { cancelUrl: 'https://booking.example.test/a/%2e%2e/cancel' },
    { successUrl: 'https://booking.example.test\\@evil.test/success' },
    { cancelUrl: 'https://booking.example.test/cancel?note=hello world' },
    { successUrl: 'https://booking.example.test./success' },
    { cancelUrl: 'https://bücher.example.test/cancel' },
    { successUrl: 'https://booking.example.test' },
    { purpose: null },
    { now: null },
  ]) {
    await assert.rejects(
      provider.createPaymentSession({ ...valid, ...overrides } as Parameters<StripeCheckoutProvider['createPaymentSession']>[0]),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST' && !error.retryable,
    );
    assert.equal(calls, 0, JSON.stringify(overrides));
  }
});

test('Checkout preserves canonical local-development return destinations without URL repair', async () => {
  const successUrl = 'http://localhost:3000/book/acme?payment=processing';
  const cancelUrl = 'http://localhost:3000/book/acme?payment=cancelled';
  let capturedBody = '';
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify(checkoutResponse({
        success_url: successUrl,
        cancel_url: cancelUrl,
      })), { status: 200 });
    },
  });
  const result = await provider.createPaymentSession({
    organizationId,
    bookingId,
    idempotencyKey: 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    money: { currency: 'USD', amountMinor: 12500n },
    successUrl,
    cancelUrl,
    now,
  });
  const form = new URLSearchParams(capturedBody);
  assert.equal(form.get('success_url'), successUrl);
  assert.equal(form.get('cancel_url'), cancelUrl);
  assert.equal(result.sessionReference, 'cs_test_abc123');
});

test('Checkout accepts an explicitly absent customer email without adding a Stripe form field', async () => {
  let body = '';
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async (_url, init) => {
      body = String(init?.body ?? '');
      return new Response(JSON.stringify(checkoutResponse()), { status: 200 });
    },
  });
  await provider.createPaymentSession({
    organizationId,
    bookingId,
    idempotencyKey: 'public:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    money: { currency: 'USD', amountMinor: 12500n },
    successUrl: 'https://booking.example.test/success',
    cancelUrl: 'https://booking.example.test/cancel',
    customerEmail: null,
    now,
  });
  assert.equal(new URLSearchParams(body).has('customer_email'), false);
});
