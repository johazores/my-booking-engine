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
    client_reference_id: bookingId,
    metadata: {
      sf_organization_id: organizationId,
      sf_booking_id: bookingId,
    },
    url: 'https://checkout.stripe.com/c/pay/cs_test_abc123#checkout',
    expires_at: Math.floor(now.getTime() / 1000) + 1800,
    amount_total: 12500,
    currency: 'usd',
    ...overrides,
  };
}

async function createBookingCheckout(overrides: Record<string, unknown>) {
  const provider = new StripeCheckoutProvider({
    secretKey: 'sk_test_checkout_secret',
    fetchImpl: async () => new Response(JSON.stringify(checkoutResponse(overrides)), { status: 200 }),
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

test('rejects created Checkout Session ownership, mode, metadata, or expiry drift', async () => {
  const cases: Record<string, unknown>[] = [
    { mode: 'subscription' },
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
    { expires_at: Math.floor(now.getTime() / 1000) + 1801 },
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
