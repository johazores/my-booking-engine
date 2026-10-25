import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { PaymentProviderError } from './payment-provider.ts';
import { StripePaymentProvider, normalizeStripePaymentIntentReference, normalizeStripePaymentMethodReference, type StripeFetch } from './stripe-payment-provider.ts';

const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
function context(idempotencyKey = 'stripe:payment:1') { return { organizationId, bookingId, idempotencyKey, money: { currency: 'USD', amountMinor: 24100n } } as const; }

test('stripe adapter authorizes with manual capture and server-owned metadata', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const fetchImpl: StripeFetch = async (input, init) => {
    requestUrl = String(input); requestInit = init;
    return new Response(JSON.stringify({ id: 'pi_authorized_1', status: 'requires_capture', amount: 24100, amount_received: 0, amount_capturable: 24100, currency: 'usd' }), { status: 200 });
  };
  const provider = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret', fetchImpl });
  const result = await provider.authorizePayment!({ ...context(), paymentMethodReference: 'pm_card_1' });
  assert.deepEqual([...provider.capabilities], ['AUTHORIZE', 'CAPTURE', 'RELEASE_AUTHORIZATION', 'REFUND', 'WEBHOOKS']);
  assert.equal(requestUrl, 'https://api.stripe.com/v1/payment_intents');
  assert.equal(new Headers(requestInit?.headers).get('idempotency-key'), 'stripe:payment:1');
  const form = new URLSearchParams(String(requestInit?.body));
  assert.equal(form.get('amount'), '24100'); assert.equal(form.get('currency'), 'usd'); assert.equal(form.get('payment_method'), 'pm_card_1');
  assert.equal(form.get('capture_method'), 'manual'); assert.equal(form.get('confirm'), 'true');
  assert.equal(form.get('metadata[sf_organization_id]'), organizationId); assert.equal(form.get('metadata[sf_booking_id]'), bookingId);
  assert.deepEqual(result, { providerCode: 'stripe', providerReference: 'pi_authorized_1', status: 'AUTHORIZED', money: { currency: 'USD', amountMinor: 24100n } });
});

test('stripe adapter supports exact partial capture, authorization release, and pending refunds', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: StripeFetch = async (input, init) => {
    const url = String(input); requests.push({ url, init });
    if (url.endsWith('/capture')) return new Response(JSON.stringify({ id: 'pi_capture_1', status: 'succeeded', amount: 24100, amount_received: 12000, currency: 'usd' }), { status: 200 });
    if (url.endsWith('/cancel')) return new Response(JSON.stringify({ id: 'pi_capture_1', status: 'canceled', amount: 24100, amount_received: 0, amount_capturable: 0, currency: 'usd' }), { status: 200 });
    return new Response(JSON.stringify({ id: 're_refund_1', payment_intent: 'pi_capture_1', status: 'pending', amount: 4100, currency: 'usd' }), { status: 200 });
  };
  const provider = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret', fetchImpl });
  const captured = await provider.capturePayment!({ ...context('stripe:capture:1'), money: { currency: 'USD', amountMinor: 12000n }, providerReference: 'pi_capture_1' });
  const released = await provider.releaseAuthorization!({ ...context('stripe:release:1'), providerReference: 'pi_capture_1' });
  const refunded = await provider.refundPayment!({ ...context('stripe:refund:1'), money: { currency: 'USD', amountMinor: 4100n }, providerReference: 'pi_capture_1' });
  assert.deepEqual(captured.money, { currency: 'USD', amountMinor: 12000n }); assert.equal(captured.status, 'PAID');
  assert.equal(new URLSearchParams(String(requests[0]?.init?.body)).get('amount_to_capture'), '12000');
  assert.equal(requests[1]?.url, 'https://api.stripe.com/v1/payment_intents/pi_capture_1/cancel');
  assert.equal(new URLSearchParams(String(requests[1]?.init?.body)).get('cancellation_reason'), 'abandoned');
  assert.equal(new Headers(requests[1]?.init?.headers).get('idempotency-key'), 'stripe:release:1');
  assert.equal(released.status, 'FAILED');
  assert.deepEqual(released.money, { currency: 'USD', amountMinor: 24100n });
  assert.equal(refunded.status, 'PENDING'); assert.equal(refunded.refundReference, 're_refund_1');
  assert.equal(new Headers(requests[2]?.init?.headers).get('idempotency-key'), 'stripe:refund:1');
});

test('stripe authorization release rejects provider identity and money drift', async () => {
  const wrongReference = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({ id: 'pi_other', status: 'canceled', amount: 24100, currency: 'usd' }), { status: 200 }),
  });
  await assert.rejects(
    wrongReference.releaseAuthorization!({ ...context('stripe:release:2'), providerReference: 'pi_expected' }),
    /different PaymentIntent/,
  );

  const wrongMoney = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({ id: 'pi_expected', status: 'canceled', amount: 1, currency: 'usd' }), { status: 200 }),
  });
  await assert.rejects(
    wrongMoney.releaseAuthorization!({ ...context('stripe:release:3'), providerReference: 'pi_expected' }),
    /does not match/,
  );
});

test('stripe adapter normalizes declines, rate limits, idempotency errors, and money mismatches', async () => {
  const cases = [
    { status: 402, body: { error: { type: 'card_error', code: 'card_declined', message: 'Card declined' } }, code: 'DECLINED', retryable: false },
    { status: 429, body: { error: { message: 'Slow down' } }, code: 'RATE_LIMITED', retryable: true },
    { status: 400, body: { error: { type: 'idempotency_error', message: 'Key reused' } }, code: 'DUPLICATE', retryable: false },
  ] as const;
  for (const item of cases) {
    const provider = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret', fetchImpl: async () => new Response(JSON.stringify(item.body), { status: item.status }) });
    await assert.rejects(provider.authorizePayment!({ ...context(), paymentMethodReference: 'pm_card_1' }), (error: unknown) => {
      assert.equal(error instanceof PaymentProviderError, true); assert.equal((error as PaymentProviderError).code, item.code); assert.equal((error as PaymentProviderError).retryable, item.retryable); return true;
    });
  }
  const mismatched = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret', fetchImpl: async () => new Response(JSON.stringify({ id: 'pi_wrong_amount', status: 'requires_capture', amount: 1, amount_received: 0, amount_capturable: 1, currency: 'usd' }), { status: 200 }) });
  await assert.rejects(mismatched.authorizePayment!({ ...context(), paymentMethodReference: 'pm_card_1' }), /does not match/);
});

test('stripe webhook verification checks raw payload and timestamp tolerance', () => {
  const provider = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret' });
  const payload = '{"id":"evt_1","type":"payment_intent.succeeded"}'; const secret = 'whsec_test_signing_secret'; const timestamp = 1_800_000_000;
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  assert.equal(provider.verifyWebhookSignature!({ payload, signature: `t=${timestamp},v1=${signature}`, secret, now: new Date(timestamp * 1000) }), true);
  assert.equal(provider.verifyWebhookSignature!({ payload: `${payload} `, signature: `t=${timestamp},v1=${signature}`, secret, now: new Date(timestamp * 1000) }), false);
  assert.equal(provider.verifyWebhookSignature!({ payload, signature: `t=${timestamp},v1=${signature}`, secret, now: new Date((timestamp + 301) * 1000) }), false);
});

test('stripe references and constructor configuration validate before requests', () => {
  assert.equal(normalizeStripePaymentIntentReference(' pi_valid_1 '), 'pi_valid_1'); assert.equal(normalizeStripePaymentMethodReference(' pm_valid_1 '), 'pm_valid_1');
  assert.throws(() => normalizeStripePaymentIntentReference('ch_wrong'), /PaymentIntent reference/); assert.throws(() => normalizeStripePaymentMethodReference('card_wrong'), /payment method reference/);
  assert.throws(() => new StripePaymentProvider({ secretKey: 'not-a-key' }), /secret key/); assert.throws(() => new StripePaymentProvider({ secretKey: 'sk_test_valid-enough', timeoutMs: 99 }), /timeout/);
});


test('Stripe write responses cannot substitute a different PaymentIntent or refund source', async () => {
  const capture = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({ id: 'pi_other', status: 'succeeded', amount: 24100, amount_received: 24100, currency: 'usd' })),
  });
  await assert.rejects(
    capture.capturePayment!({ ...context('stripe:capture:identity'), providerReference: 'pi_expected' }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
  );

  for (const refund of [
    { id: 're_valid_1', payment_intent: 'pi_other', status: 'succeeded', amount: 4100, currency: 'usd' },
    { id: 'ch_not_a_refund', payment_intent: 'pi_expected', status: 'succeeded', amount: 4100, currency: 'usd' },
    { id: 're_valid_1', status: 'succeeded', amount: 4100, currency: 'usd' },
  ]) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify(refund)),
    });
    await assert.rejects(
      provider.refundPayment!({ ...context('stripe:refund:identity'), money: { currency: 'USD', amountMinor: 4100n }, providerReference: 'pi_expected' }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
});

test('Stripe successful payment responses must prove received money instead of assuming it', async () => {
  for (const received of [undefined, 1]) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({ id: 'pi_authorized_1', status: 'succeeded', amount: 24100, amount_received: received, currency: 'usd' })),
    });
    await assert.rejects(
      provider.authorizePayment!({ ...context('stripe:auth:received'), paymentMethodReference: 'pm_card_1' }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
    await assert.rejects(
      provider.capturePayment!({ ...context('stripe:capture:received'), providerReference: 'pi_authorized_1' }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
});


test('Stripe accepts provider-proven successful authorization and rejects padded release identity', async () => {
  const authorized = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'pi_received_1', status: 'succeeded', amount: 24100, amount_received: 24100, currency: 'usd',
    })),
  });
  const result = await authorized.authorizePayment!({ ...context('stripe:auth:proven'), paymentMethodReference: 'pm_card_1' });
  assert.equal(result.status, 'PAID');
  assert.equal(result.providerReference, 'pi_received_1');

  const release = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: ' pi_expected ', status: 'canceled', amount: 24100, currency: 'usd',
    })),
  });
  await assert.rejects(
    release.releaseAuthorization!({ ...context('stripe:release:padded'), providerReference: 'pi_expected' }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
  );
});

test('Stripe authorization requires provider-proven full capturable funds', async () => {
  for (const evidence of [
    { amount_capturable: undefined, amount_received: 0 },
    { amount_capturable: 0, amount_received: 0 },
    { amount_capturable: 24099, amount_received: 0 },
    { amount_capturable: 24101, amount_received: 0 },
    { amount_capturable: -1, amount_received: 0 },
    { amount_capturable: 24100.5, amount_received: 0 },
    { amount_capturable: 24100, amount_received: undefined },
    { amount_capturable: 24100, amount_received: 1 },
  ]) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 'pi_authorization_evidence', status: 'requires_capture', amount: 24100, currency: 'usd', ...evidence,
      })),
    });
    await assert.rejects(
      provider.authorizePayment!({ ...context('stripe:auth:capturable'), paymentMethodReference: 'pm_card_1' }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
});

test('Stripe cancellation and unexpected settlement responses require explicit terminal money evidence', async () => {
  const cases = [
    { status: 'canceled', amount_received: undefined, amount_capturable: 0 },
    { status: 'canceled', amount_received: 0, amount_capturable: undefined },
    { status: 'canceled', amount_received: 1, amount_capturable: 0 },
    { status: 'canceled', amount_received: 0, amount_capturable: 1 },
    { status: 'succeeded', amount_received: undefined, amount_capturable: 0 },
    { status: 'succeeded', amount_received: 24100, amount_capturable: undefined },
    { status: 'succeeded', amount_received: 24099, amount_capturable: 0 },
    { status: 'succeeded', amount_received: 24100, amount_capturable: 1 },
  ] as const;
  for (const evidence of cases) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 'pi_release_evidence', amount: 24100, currency: 'usd', ...evidence,
      })),
    });
    await assert.rejects(
      provider.releaseAuthorization!({ ...context('stripe:release:evidence'), providerReference: 'pi_release_evidence' }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
  const released = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'pi_release_evidence', status: 'canceled', amount: 24100,
      amount_received: 0, amount_capturable: 0, currency: 'usd',
    })),
  });
  assert.equal(
    (await released.releaseAuthorization!({ ...context('stripe:release:valid'), providerReference: 'pi_release_evidence' })).status,
    'FAILED',
  );
});
