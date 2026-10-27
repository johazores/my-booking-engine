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
    if (url.endsWith('/capture')) return new Response(JSON.stringify({ id: 'pi_capture_1', status: 'succeeded', amount: 24100, amount_received: 12000, amount_capturable: 0, currency: 'usd' }), { status: 200 });
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
    { status: 402, body: { error: { type: 'card_error' } }, code: 'UNKNOWN', retryable: true },
    { status: 402, body: { error: { type: 'card_error', decline_code: ' ' } }, code: 'UNKNOWN', retryable: true },
    { status: 402, body: { error: { type: 'card_error', code: 'expired_card' } }, code: 'DECLINED', retryable: false },
    { status: 429, body: { error: { message: 'Slow down' } }, code: 'RATE_LIMITED', retryable: true },
    { status: 409, body: { error: { type: 'invalid_request_error', code: 'idempotency_key_in_use' } }, code: 'UNKNOWN', retryable: true },
    { status: 409, body: { error: { type: 'idempotency_error', code: 'idempotency_key_in_use' } }, code: 'UNKNOWN', retryable: true },
    { status: 424, body: { error: { type: 'card_error', message: 'Upstream dependency unavailable' } }, code: 'PROVIDER_UNAVAILABLE', retryable: true },
    { status: 402, body: { error: { message: 'Unclassified payment failure' } }, code: 'UNKNOWN', retryable: true },
    { status: 400, body: { error: { type: 'idempotency_error', message: 'Key reused' } }, code: 'DUPLICATE', retryable: false },
    { status: 400, body: { error: { type: 'card_error', code: 'card_declined' } }, code: 'INVALID_REQUEST', retryable: false },
    { status: 404, body: { error: { type: 'card_error' } }, code: 'INVALID_REQUEST', retryable: false },
    { status: 400, body: { error: { type: 'api_error' } }, code: 'UNKNOWN', retryable: true },
    { status: 402, body: { error: { type: 'card_error', code: 'authentication_required' } }, code: 'UNKNOWN', retryable: true },
    { status: 402, body: { error: { type: 'card_error', decline_code: 'authentication_required' } }, code: 'UNKNOWN', retryable: true },
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

test('Stripe capture, release, and refund writes preserve ambiguous provider conflicts and dependency failures', async () => {
  for (const item of [
    { status: 409, code: 'UNKNOWN', body: { error: { code: 'idempotency_key_in_use' } } },
    { status: 424, code: 'PROVIDER_UNAVAILABLE', body: { error: { type: 'card_error' } } },
    { status: 400, code: 'UNKNOWN', body: { error: { type: 'api_error' } } },
  ] as const) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify(item.body), { status: item.status }),
    });
    const operations = [
      () => provider.capturePayment!({ ...context('stripe:capture:conflict'), providerReference: 'pi_expected' }),
      () => provider.releaseAuthorization!({ ...context('stripe:release:conflict'), providerReference: 'pi_expected' }),
      () => provider.refundPayment!({ ...context('stripe:refund:conflict'), money: { currency: 'USD', amountMinor: 4100n }, providerReference: 'pi_expected' }),
    ];
    for (const operation of operations) {
      await assert.rejects(operation(),
        (error: unknown) => error instanceof PaymentProviderError && error.code === item.code && error.retryable);
    }
  }
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
  assert.equal(normalizeStripePaymentIntentReference(`pi_${'x'.repeat(157)}`).length, 160);
  assert.throws(() => normalizeStripePaymentIntentReference(`pi_${'x'.repeat(158)}`), /PaymentIntent reference/);
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
      fetchImpl: async () => new Response(JSON.stringify({ id: 'pi_authorized_1', status: 'succeeded', amount: 24100, amount_received: received, amount_capturable: 0, currency: 'usd' })),
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
      id: 'pi_received_1', status: 'succeeded', amount: 24100, amount_received: 24100, amount_capturable: 0, currency: 'usd',
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


test('Stripe direct payment writes reject contradictory terminal money evidence', async () => {
  const cases = [
    { operation: 'authorize', status: 'canceled', amount_received: undefined, amount_capturable: 0 },
    { operation: 'authorize', status: 'canceled', amount_received: 1, amount_capturable: 0 },
    { operation: 'authorize', status: 'canceled', amount_received: 0, amount_capturable: 1 },
    { operation: 'authorize', status: 'succeeded', amount_received: 24100, amount_capturable: undefined },
    { operation: 'authorize', status: 'succeeded', amount_received: 24100, amount_capturable: 1 },
    { operation: 'capture', status: 'canceled', amount_received: 0, amount_capturable: undefined },
    { operation: 'capture', status: 'canceled', amount_received: 1, amount_capturable: 0 },
    { operation: 'capture', status: 'succeeded', amount_received: 24100, amount_capturable: undefined },
    { operation: 'capture', status: 'succeeded', amount_received: 24100, amount_capturable: 1 },
  ] as const;
  for (const item of cases) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 'pi_terminal_write', status: item.status, amount: 24100,
        amount_received: item.amount_received, amount_capturable: item.amount_capturable, currency: 'usd',
      })),
    });
    const request = item.operation === 'authorize'
      ? provider.authorizePayment!({ ...context('stripe:terminal:auth'), paymentMethodReference: 'pm_card_1' })
      : provider.capturePayment!({ ...context('stripe:terminal:capture'), providerReference: 'pi_terminal_write' });
    await assert.rejects(request, (error: unknown) => (
      error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable
    ));
  }
});

test('Stripe direct authorization records an evidenced card decline as failed', async () => {
  const provider = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'pi_declined_1', status: 'requires_payment_method', amount: 24100,
      amount_received: 0, amount_capturable: 0, currency: 'usd',
    })),
  });
  const result = await provider.authorizePayment!({ ...context('stripe:auth:declined'), paymentMethodReference: 'pm_card_1' });
  assert.deepEqual(result, {
    providerCode: 'stripe', providerReference: 'pi_declined_1',
    status: 'FAILED', money: { currency: 'USD', amountMinor: 24100n },
  });
});

test('Stripe direct authorization cannot fail a payment without complete zero-money evidence', async () => {
  for (const evidence of [
    { amount_received: undefined, amount_capturable: 0 },
    { amount_received: 0, amount_capturable: undefined },
    { amount_received: null, amount_capturable: 0 },
    { amount_received: 0, amount_capturable: null },
    { amount_received: 1, amount_capturable: 0 },
    { amount_received: 0, amount_capturable: 1 },
    { amount_received: -1, amount_capturable: 0 },
    { amount_received: 0, amount_capturable: 0.5 },
  ]) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 'pi_declined_evidence', status: 'requires_payment_method', amount: 24100,
        currency: 'usd', ...evidence,
      })),
    });
    await assert.rejects(
      provider.authorizePayment!({ ...context('stripe:auth:declined-evidence'), paymentMethodReference: 'pm_card_1' }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
});

test('Stripe cancellation and capture do not treat a reusable failed intent as proven release or capture', async () => {
  const provider = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'pi_reusable_failed', status: 'requires_payment_method', amount: 24100,
      amount_received: 0, amount_capturable: 0, currency: 'usd',
    })),
  });
  const release = await provider.releaseAuthorization!({
    ...context('stripe:release:reusable-failed'), providerReference: 'pi_reusable_failed',
  });
  assert.equal(release.status, 'PENDING');
  await assert.rejects(
    provider.capturePayment!({ ...context('stripe:capture:reusable-failed'), providerReference: 'pi_reusable_failed' }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
  );
});

test('Stripe capture never promotes an uncompleted capture to an authorization', async () => {
  const provider = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'pi_capture_still_authorized', status: 'requires_capture', amount: 24100,
      amount_received: 0, amount_capturable: 24100, currency: 'usd',
    })),
  });
  const result = await provider.capturePayment!({
    ...context('stripe:capture:still-authorized'), providerReference: 'pi_capture_still_authorized',
  });
  assert.equal(result.status, 'PENDING');
  assert.equal(result.money.amountMinor, 24100n);
});

test('Stripe capture rejects missing and contradictory pending money evidence', async () => {
  for (const evidence of [
    { status: 'requires_capture', amount_received: undefined, amount_capturable: 24100 },
    { status: 'requires_capture', amount_received: 0, amount_capturable: undefined },
    { status: 'requires_capture', amount_received: 1, amount_capturable: 24099 },
    { status: 'requires_capture', amount_received: 0, amount_capturable: 0 },
    { status: 'processing', amount_received: undefined, amount_capturable: 0 },
    { status: 'processing', amount_received: 1, amount_capturable: 0 },
    { status: 'processing', amount_received: 0, amount_capturable: 24101 },
    { status: 'processing', amount_received: 0, amount_capturable: 0, currency: 'eur' },
    { status: 'processing', amount_received: 0, amount_capturable: 0, amount: 24099 },
    { status: 'requires_payment_method', amount_received: 0, amount_capturable: 0 },
    { status: 'canceled', amount_received: 0, amount_capturable: 0 },
  ]) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 'pi_capture_ambiguous', amount: 24100, currency: 'usd', ...evidence,
      })),
    });
    await assert.rejects(
      provider.capturePayment!({ ...context('stripe:capture:ambiguous'), providerReference: 'pi_capture_ambiguous' }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
  const pending = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'pi_capture_processing', status: 'processing', amount: 24100,
      amount_received: 0, amount_capturable: 0, currency: 'usd',
    })),
  });
  assert.equal((await pending.capturePayment!({
    ...context('stripe:capture:processing'), providerReference: 'pi_capture_processing',
  })).status, 'PENDING');
});

test('Stripe nonterminal authorization requires explicit zero-money evidence', async () => {
  for (const evidence of [
    { amount_received: undefined, amount_capturable: 0 },
    { amount_received: 0, amount_capturable: undefined },
    { amount_received: 1, amount_capturable: 0 },
    { amount_received: 0, amount_capturable: 1 },
  ]) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 'pi_authorization_processing', status: 'processing', amount: 24100,
        currency: 'usd', ...evidence,
      })),
    });
    await assert.rejects(
      provider.authorizePayment!({ ...context('stripe:auth:processing-evidence'), paymentMethodReference: 'pm_card_1' }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
  const provider = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'pi_authorization_processing', status: 'processing', amount: 24100,
      amount_received: 0, amount_capturable: 0, currency: 'usd',
    })),
  });
  assert.equal((await provider.authorizePayment!({
    ...context('stripe:auth:processing-valid'), paymentMethodReference: 'pm_card_1',
  })).status, 'PENDING');
});

test('Stripe direct PaymentIntent writes reject unknown provider statuses', async () => {
  for (const status of [undefined, null, '', 'not_a_stripe_state', 123]) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 'pi_unknown_state', status, amount: 24100,
        amount_received: 0, amount_capturable: 0, currency: 'usd',
      })),
    });
    for (const operation of [
      () => provider.authorizePayment!({ ...context('stripe:auth:unknown-status'), paymentMethodReference: 'pm_card_1' }),
      () => provider.capturePayment!({ ...context('stripe:capture:unknown-status'), providerReference: 'pi_unknown_state' }),
      () => provider.releaseAuthorization!({ ...context('stripe:release:unknown-status'), providerReference: 'pi_unknown_state' }),
    ]) {
      await assert.rejects(
        operation(),
        (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
      );
    }
  }
});

test('Stripe pending release requires complete provider money and never claims authorization success', async () => {
  for (const evidence of [
    { amount_received: undefined, amount_capturable: 24100 },
    { amount_received: 0, amount_capturable: undefined },
    { amount_received: 1, amount_capturable: 24099 },
    { amount_received: 0, amount_capturable: 24101 },
    { amount_received: 0, amount_capturable: 0 },
  ]) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 'pi_release_pending', status: 'requires_capture', amount: 24100,
        currency: 'usd', ...evidence,
      })),
    });
    await assert.rejects(
      provider.releaseAuthorization!({ ...context('stripe:release:pending-evidence'), providerReference: 'pi_release_pending' }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
  const provider = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'pi_release_pending', status: 'requires_capture', amount: 24100,
      amount_received: 0, amount_capturable: 24100, currency: 'usd',
    })),
  });
  assert.equal((await provider.releaseAuthorization!({
    ...context('stripe:release:still-authorized'), providerReference: 'pi_release_pending',
  })).status, 'PENDING');
});

test('refund write refuses unknown Stripe states and preserves known refund lifecycle', async () => {
  for (const status of [undefined, null, 'unknown', 'paid', 'PENDING', ' pending ', 123]) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 're_status_1', payment_intent: 'pi_source_1', status, amount: 24100, currency: 'usd',
      })),
    });
    await assert.rejects(
      provider.refundPayment!({ ...context('stripe:refund:status'), providerReference: 'pi_source_1' }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
  for (const status of ['pending', 'requires_action', 'succeeded', 'failed', 'canceled']) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 're_status_1', payment_intent: 'pi_source_1', status, amount: 24100, currency: 'usd',
      })),
    });
    const result = await provider.refundPayment!({ ...context('stripe:refund:known'), providerReference: 'pi_source_1' });
    assert.equal(result.status, status === 'succeeded' ? 'REFUNDED' : ['failed', 'canceled'].includes(status) ? 'FAILED' : 'PENDING');
  }
});

test('Stripe cannot persist an oversized provider-created PaymentIntent or refund reference', async () => {
  const oversizedIntent = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: `pi_${'x'.repeat(158)}`, status: 'requires_capture', amount: 24100,
      amount_received: 0, amount_capturable: 24100, currency: 'usd',
    })),
  });
  await assert.rejects(
    oversizedIntent.authorizePayment!({ ...context('stripe:oversized-intent'), paymentMethodReference: 'pm_card_1' }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
  );
  const oversizedRefund = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: `re_${'x'.repeat(158)}`, payment_intent: 'pi_source_1',
      status: 'succeeded', amount: 4100, currency: 'usd',
    })),
  });
  await assert.rejects(
    oversizedRefund.refundPayment!({
      ...context('stripe:oversized-refund'), providerReference: 'pi_source_1',
      money: { currency: 'USD', amountMinor: 4100n },
    }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
  );
});

test('Stripe direct writes classify invalid provider currencies as retryable unknown evidence', async () => {
  for (const currency of [null, 'zzz', 'USD', ' usd ', 123]) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async (url) => new Response(JSON.stringify(String(url).endsWith('/refunds')
        ? { id: 're_currency_1', payment_intent: 'pi_currency_1', status: 'succeeded', amount: 24100, currency }
        : { id: 'pi_currency_1', status: 'requires_capture', amount: 24100, amount_received: 0, amount_capturable: 24100, currency })),
    });
    for (const operation of [
      () => provider.authorizePayment!({ ...context('stripe:currency:auth'), paymentMethodReference: 'pm_card_1' }),
      () => provider.capturePayment!({ ...context('stripe:currency:capture'), providerReference: 'pi_currency_1' }),
      () => provider.releaseAuthorization!({ ...context('stripe:currency:release'), providerReference: 'pi_currency_1' }),
      () => provider.refundPayment!({ ...context('stripe:currency:refund'), providerReference: 'pi_currency_1' }),
    ]) {
      await assert.rejects(operation(), (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable);
    }
  }
});

test('Stripe direct writes retain HTTP error classification with malformed error JSON', async () => {
  for (const [status, code, retryable] of [[429, 'RATE_LIMITED', true], [401, 'AUTHENTICATION_FAILED', false]] as const) {
    for (const payload of [null, [], { error: { message: 7 } }]) {
      const provider = new StripePaymentProvider({
        secretKey: 'sk_test_not-a-real-secret',
        fetchImpl: async () => new Response(JSON.stringify(payload), { status }),
      });
      await assert.rejects(provider.authorizePayment!({ ...context('stripe:bad-error'), paymentMethodReference: 'pm_card_1' }),
        (error: unknown) => error instanceof PaymentProviderError && error.code === code && error.retryable === retryable);
    }
  }
});

test('Stripe payment and refund writes preserve retryable HTTP status over misleading error bodies', async () => {
  for (const item of [
    { status: 408, type: 'idempotency_error', code: 'TIMEOUT' },
    { status: 429, type: 'idempotency_error', code: 'RATE_LIMITED' },
    { status: 503, type: 'card_error', code: 'PROVIDER_UNAVAILABLE' },
  ] as const) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({ error: { type: item.type } }), { status: item.status }),
    });
    for (const operation of [
      () => provider.authorizePayment!({ ...context('stripe:transport:authorize'), paymentMethodReference: 'pm_card_1' }),
      () => provider.refundPayment!({ ...context('stripe:transport:refund'), providerReference: 'pi_payment_1' }),
    ]) {
      await assert.rejects(operation(), (error: unknown) =>
        error instanceof PaymentProviderError && error.code === item.code && error.retryable);
    }
  }
});
