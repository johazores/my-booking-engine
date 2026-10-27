import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { PaymentProviderError } from './payment-provider.ts';
import { StripePaymentProvider, normalizeStripePaymentIntentReference, normalizeStripePaymentMethodReference, type StripeFetch } from './stripe-payment-provider.ts';

const organizationId = 'a1111111-1111-4111-8111-111111111111';
const bookingId = 'b2222222-2222-4222-8222-222222222222';
function context(idempotencyKey = 'stripe:payment:1') { return { organizationId, bookingId, idempotencyKey, money: { currency: 'USD', amountMinor: 24100n } } as const; }

// Successful Stripe resource fixtures include the same metadata that SF sends.
// Explicit negative ownership tests below use JSON.stringify without this helper.
function stripeJson(value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const resource = value as Record<string, unknown>;
    if (typeof resource.id === 'string') {
      return JSON.stringify({
        metadata: { sf_organization_id: organizationId, sf_booking_id: bookingId },
        ...resource,
      });
    }
  }
  return JSON.stringify(value);
}

test('stripe adapter authorizes with manual capture and server-owned metadata', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const fetchImpl: StripeFetch = async (input, init) => {
    requestUrl = String(input); requestInit = init;
    return new Response(stripeJson({ id: 'pi_authorized_1', status: 'requires_capture', amount: 24100, amount_received: 0, amount_capturable: 24100, currency: 'usd' }), { status: 200 });
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


test('Stripe direct payment writes snapshot tenant, booking, money, and idempotency authority once', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: StripeFetch = async (url, init) => {
    const path = String(url);
    requests.push({ url: path, init });
    if (path.endsWith('/capture')) {
      return new Response(stripeJson({ id: 'pi_capture_1', status: 'succeeded', amount: 24100, amount_received: 24100, amount_capturable: 0, currency: 'usd' }));
    }
    if (path.endsWith('/cancel')) {
      return new Response(stripeJson({ id: 'pi_capture_1', status: 'canceled', amount: 24100, amount_received: 0, amount_capturable: 0, currency: 'usd' }));
    }
    if (path.endsWith('/refunds')) {
      return new Response(stripeJson({ id: 're_refund_1', payment_intent: 'pi_capture_1', status: 'pending', amount: 24100, currency: 'usd' }));
    }
    return new Response(stripeJson({ id: 'pi_authorized_1', status: 'requires_capture', amount: 24100, amount_received: 0, amount_capturable: 24100, currency: 'usd' }));
  };
  const provider = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret', fetchImpl });
  const otherOrganization = 'c3333333-3333-4333-8333-333333333333';
  for (const operation of ['authorize', 'capture', 'release', 'refund'] as const) {
    const reads = { organization: 0, booking: 0, key: 0, money: 0, currency: 0, amount: 0, reference: 0 };
    const money = {
      get currency() { reads.currency += 1; return reads.currency === 1 ? 'USD' : 'EUR'; },
      get amountMinor() { reads.amount += 1; return reads.amount === 1 ? 24100n : 1n; },
    };
    const input = {
      get organizationId() { reads.organization += 1; return reads.organization === 1 ? organizationId : otherOrganization; },
      get bookingId() { reads.booking += 1; return reads.booking === 1 ? bookingId : otherOrganization; },
      get idempotencyKey() { reads.key += 1; return reads.key === 1 ? 'stripe:stable:payment' : 'stripe:drift:payment'; },
      get money() { reads.money += 1; return reads.money === 1 ? money : { currency: 'EUR', amountMinor: 1n }; },
      get paymentMethodReference() { reads.reference += 1; return reads.reference === 1 ? 'pm_card_1' : 'pm_other'; },
      get providerReference() { reads.reference += 1; return reads.reference === 1 ? 'pi_capture_1' : 'pi_other'; },
    };
    if (operation === 'authorize') await provider.authorizePayment(input);
    else if (operation === 'capture') await provider.capturePayment(input);
    else if (operation === 'release') await provider.releaseAuthorization(input);
    else await provider.refundPayment(input);

    assert.deepEqual(reads, { organization: 1, booking: 1, key: 1, money: 1, currency: 1, amount: 1, reference: 1 }, operation);
    const request = requests.at(-1);
    assert.ok(request);
    assert.equal(new Headers(request.init?.headers).get('idempotency-key'), 'stripe:stable:payment', operation);
    const form = new URLSearchParams(String(request.init?.body));
    if (operation === 'authorize' || operation === 'refund') {
      assert.equal(form.get('metadata[sf_organization_id]'), organizationId, operation);
      assert.equal(form.get('metadata[sf_booking_id]'), bookingId, operation);
    }
    if (operation === 'authorize' || operation === 'refund') assert.equal(form.get('amount'), '24100', operation);
    if (operation === 'capture') assert.equal(form.get('amount_to_capture'), '24100');
  }
  assert.equal(requests.length, 4);
});

test('Stripe direct writes reject throwing commercial input getters without provider I/O', async () => {
  let calls = 0;
  const provider = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => { calls += 1; throw new Error('Must not contact Stripe.'); },
  });
  const invalid = {
    ...context(),
    get bookingId(): string { throw new Error('private getter error'); },
    paymentMethodReference: 'pm_card_1',
    providerReference: 'pi_capture_1',
  };
  for (const operation of [
    () => provider.authorizePayment(invalid),
    () => provider.capturePayment(invalid),
    () => provider.releaseAuthorization(invalid),
    () => provider.refundPayment(invalid),
  ]) {
    await assert.rejects(operation(), (error: unknown) => error instanceof PaymentProviderError
      && error.code === 'INVALID_REQUEST' && !error.retryable && !error.message.includes('private getter error'));
  }
  const invalidNestedMoney = {
    ...context(),
    money: { get currency(): string { throw new Error('nested secret'); }, amountMinor: 24100n },
    paymentMethodReference: 'pm_card_1',
  };
  await assert.rejects(provider.authorizePayment(invalidNestedMoney), (error: unknown) => error instanceof PaymentProviderError
    && error.code === 'INVALID_REQUEST' && !error.retryable);
  const badMethod = {
    ...context(),
    get paymentMethodReference(): string { throw new Error('private method reference'); },
  };
  await assert.rejects(provider.authorizePayment(badMethod), (error: unknown) => error instanceof PaymentProviderError
    && error.code === 'INVALID_REQUEST' && !error.retryable && !error.message.includes('private method reference'));
  const badProviderReference = {
    ...context(),
    get providerReference(): string { throw new Error('private provider reference'); },
  };
  for (const operation of [
    () => provider.capturePayment(badProviderReference),
    () => provider.releaseAuthorization(badProviderReference),
    () => provider.refundPayment(badProviderReference),
  ]) {
    await assert.rejects(operation(), (error: unknown) => error instanceof PaymentProviderError
      && error.code === 'INVALID_REQUEST' && !error.retryable && !error.message.includes('private provider reference'));
  }
  assert.equal(calls, 0);
});

test('Stripe webhook verification snapshots signed payload, secret, signature, and clock once', () => {
  const provider = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret' });
  const payload = '{"id":"evt_1","type":"payment_intent.succeeded"}';
  const secret = 'whsec_test_signing_secret';
  const timestamp = 1_800_000_000;
  const signature = `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex')}`;
  const reads = { payload: 0, secret: 0, signature: 0, now: 0 };
  const signedInput = {
    get payload() { reads.payload += 1; return reads.payload === 1 ? payload : 'altered payload'; },
    get secret() { reads.secret += 1; return reads.secret === 1 ? secret : 'whsec_drift'; },
    get signature() { reads.signature += 1; return reads.signature === 1 ? signature : 'invalid'; },
    get now() { reads.now += 1; return reads.now === 1 ? new Date(timestamp * 1000) : new Date((timestamp + 500) * 1000); },
  };
  assert.equal(provider.verifyWebhookSignature(signedInput), true);
  assert.deepEqual(reads, { payload: 1, secret: 1, signature: 1, now: 1 });
  assert.equal(provider.verifyWebhookSignature({
    get payload(): string { throw new Error('private signed payload'); },
    signature,
    secret,
  }), false);
});

test('stripe adapter supports exact partial capture, authorization release, and pending refunds', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: StripeFetch = async (input, init) => {
    const url = String(input); requests.push({ url, init });
    if (url.endsWith('/capture')) return new Response(stripeJson({ id: 'pi_capture_1', status: 'succeeded', amount: 24100, amount_received: 12000, amount_capturable: 0, currency: 'usd' }), { status: 200 });
    if (url.endsWith('/cancel')) return new Response(stripeJson({ id: 'pi_capture_1', status: 'canceled', amount: 24100, amount_received: 0, amount_capturable: 0, currency: 'usd' }), { status: 200 });
    return new Response(stripeJson({ id: 're_refund_1', payment_intent: 'pi_capture_1', status: 'pending', amount: 4100, currency: 'usd' }), { status: 200 });
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
    fetchImpl: async () => new Response(stripeJson({ id: 'pi_other', status: 'canceled', amount: 24100, currency: 'usd' }), { status: 200 }),
  });
  await assert.rejects(
    wrongReference.releaseAuthorization!({ ...context('stripe:release:2'), providerReference: 'pi_expected' }),
    /different PaymentIntent/,
  );

  const wrongMoney = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(stripeJson({ id: 'pi_expected', status: 'canceled', amount: 1, currency: 'usd' }), { status: 200 }),
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
    { status: 400, body: { error: { type: 'idempotency_error', message: 'Key reused' } }, code: 'UNKNOWN', retryable: true },
    { status: 400, body: { error: { type: 'idempotency_error', code: 'idempotency_key_reused' } }, code: 'DUPLICATE', retryable: false },
    { status: 409, body: { error: { type: 'idempotency_error', code: 'idempotency_key_reused' } }, code: 'DUPLICATE', retryable: false },
    { status: 402, body: { error: { code: 'card_declined' } }, code: 'UNKNOWN', retryable: true },
    { status: 402, body: { error: { type: 'card_error', code: 'idempotency_key_reused' } }, code: 'UNKNOWN', retryable: true },
    { status: 400, body: { error: { type: 'card_error', code: 'card_declined' } }, code: 'INVALID_REQUEST', retryable: false },
    { status: 404, body: { error: { type: 'card_error' } }, code: 'INVALID_REQUEST', retryable: false },
    { status: 400, body: { error: { type: 'api_error' } }, code: 'UNKNOWN', retryable: true },
    { status: 402, body: { error: { type: 'card_error', code: 'authentication_required' } }, code: 'UNKNOWN', retryable: true },
    { status: 402, body: { error: { type: 'card_error', decline_code: 'authentication_required' } }, code: 'UNKNOWN', retryable: true },
  ] as const;
  for (const item of cases) {
    const provider = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret', fetchImpl: async () => new Response(stripeJson(item.body), { status: item.status }) });
    await assert.rejects(provider.authorizePayment!({ ...context(), paymentMethodReference: 'pm_card_1' }), (error: unknown) => {
      assert.equal(error instanceof PaymentProviderError, true); assert.equal((error as PaymentProviderError).code, item.code); assert.equal((error as PaymentProviderError).retryable, item.retryable); return true;
    });
  }
  const mismatched = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret', fetchImpl: async () => new Response(stripeJson({ id: 'pi_wrong_amount', status: 'requires_capture', amount: 1, amount_received: 0, amount_capturable: 1, currency: 'usd' }), { status: 200 }) });
  await assert.rejects(mismatched.authorizePayment!({ ...context(), paymentMethodReference: 'pm_card_1' }), /does not match/);
});

test('Stripe capture, release, and refund writes preserve ambiguous provider conflicts and dependency failures', async () => {
  for (const item of [
    { status: 409, code: 'UNKNOWN', body: { error: { code: 'idempotency_key_in_use' } } },
    { status: 424, code: 'PROVIDER_UNAVAILABLE', body: { error: { type: 'card_error' } } },
    { status: 400, code: 'UNKNOWN', body: { error: { type: 'api_error' } } },
    { status: 400, code: 'UNKNOWN', body: { error: { type: 'idempotency_error' } } },
    { status: 409, code: 'UNKNOWN', body: { error: { type: 'idempotency_error', code: 'future_code' } } },
    { status: 402, code: 'UNKNOWN', body: { error: { type: 'card_error', code: 'idempotency_key_reused' } } },
  ] as const) {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(stripeJson(item.body), { status: item.status }),
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

test('Stripe webhook verification rejects timestamp header aliases even with an otherwise valid HMAC', () => {
  const provider = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret' });
  const payload = '{"id":"evt_1","type":"payment_intent.succeeded"}';
  const secret = 'whsec_test_signing_secret';
  const timestamp = '1800000000';
  const sign = (value: string) => createHmac('sha256', secret).update(`${value}.${payload}`, 'utf8').digest('hex');
  const verify = (header: string) => provider.verifyWebhookSignature!({
    payload, signature: header, secret, now: new Date(Number(timestamp) * 1000),
  });
  assert.equal(verify(`t=${timestamp},v1=${sign(timestamp)}`), true);
  // Reusing a genuine signature with a changed timestamp spelling must not work.
  const paddedTimestamp = `0${timestamp}`;
  assert.equal(verify(`t=${paddedTimestamp},v1=${sign(timestamp)}`), false);
  // Nor should a signature over the padded spelling bypass canonical framing.
  assert.equal(verify(`t=${paddedTimestamp},v1=${sign(paddedTimestamp)}`), false);
});

test('stripe webhook verification fails closed for invalid clock authority and malformed runtime input', () => {
  const provider = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret' });
  const payload = '{"id":"evt_1","type":"payment_intent.succeeded"}';
  const secret = 'whsec_test_signing_secret';
  const timestamp = 1_800_000_000;
  const signature = `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex')}`;
  const verify = (overrides: Record<string, unknown>) => provider.verifyWebhookSignature!({
    payload, secret, signature, now: new Date(timestamp * 1000), ...overrides,
  } as Parameters<StripePaymentProvider['verifyWebhookSignature']>[0]);

  // The exact replay-window boundary remains inclusive, in both directions.
  for (const deltaSeconds of [-301, -300, 0, 300, 301]) {
    assert.equal(verify({ now: new Date((timestamp + deltaSeconds) * 1000) }), Math.abs(deltaSeconds) <= 300);
  }
  for (const now of [
    new Date(Number.NaN),
    null,
    '2027-01-15T08:00:00Z',
    timestamp,
    Object.create(Date.prototype),
    new Proxy(new Date(timestamp * 1000), {}),
  ]) {
    assert.equal(verify({ now }), false);
  }
  const invalidDateWithForgedGetter = new Date(Number.NaN);
  Object.defineProperty(invalidDateWithForgedGetter, 'getTime', { value: () => timestamp * 1000 });
  assert.equal(verify({ now: invalidDateWithForgedGetter }), false);

  // A shadowed getter cannot alter a valid Date's native timestamp either.
  const validDateWithShadowedGetter = new Date(timestamp * 1000);
  Object.defineProperty(validDateWithShadowedGetter, 'getTime', { value: () => Number.NaN });
  assert.equal(verify({ now: validDateWithShadowedGetter }), true);

  for (const [field, value] of [
    ['secret', null], ['secret', 7], ['payload', null], ['payload', {}],
  ] as const) {
    assert.equal(verify({ [field]: value }), false);
  }
  assert.equal(verify({ payload: `${payload} ` }), false);
  assert.equal(provider.verifyWebhookSignature!(null as unknown as Parameters<StripePaymentProvider['verifyWebhookSignature']>[0]), false);
});

test('stripe references and constructor configuration validate before requests', () => {
  assert.equal(normalizeStripePaymentIntentReference('pi_valid_1'), 'pi_valid_1');
  assert.equal(normalizeStripePaymentMethodReference('pm_valid_1'), 'pm_valid_1');
  for (const padded of [' pi_valid_1', 'pi_valid_1 ', '\tpi_valid_1', 'pi_valid_1\n']) {
    assert.throws(() => normalizeStripePaymentIntentReference(padded), /PaymentIntent reference/);
  }
  for (const padded of [' pm_valid_1', 'pm_valid_1 ', '\tpm_valid_1', 'pm_valid_1\n']) {
    assert.throws(() => normalizeStripePaymentMethodReference(padded), /payment method reference/);
  }
  assert.throws(() => normalizeStripePaymentIntentReference('ch_wrong'), /PaymentIntent reference/);
  assert.throws(() => normalizeStripePaymentMethodReference('card_wrong'), /payment method reference/);
  assert.equal(normalizeStripePaymentIntentReference(`pi_${'x'.repeat(157)}`).length, 160);
  assert.throws(() => normalizeStripePaymentIntentReference(`pi_${'x'.repeat(158)}`), /PaymentIntent reference/);
  assert.equal(normalizeStripePaymentMethodReference(`pm_${'x'.repeat(157)}`).length, 160);
  assert.throws(() => normalizeStripePaymentMethodReference(`pm_${'x'.repeat(158)}`), /payment method reference/);
  assert.throws(() => new StripePaymentProvider({ secretKey: 'not-a-key' }), /secret key/); assert.throws(() => new StripePaymentProvider({ secretKey: 'sk_test_valid-enough', timeoutMs: 99 }), /timeout/);
});


test('Stripe authorization rejects noncanonical PaymentMethod IDs before any provider request', async () => {
  let calls = 0;
  const provider = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => { calls += 1; throw new Error('Invalid PaymentMethod must not reach Stripe.'); },
  });
  for (const reference of [
    ' pm_card_1', 'pm_card_1 ', '\tpm_card_1', 'pm_card_1\n',
    'pm_', 'card_wrong', `pm_${'x'.repeat(158)}`,
    null, undefined, 123, ['pm_card_1'],
  ]) {
    await assert.rejects(
      provider.authorizePayment({
        ...context('stripe:auth:noncanonical-method'),
        paymentMethodReference: reference as string,
      }),
      (error: unknown) => error instanceof PaymentProviderError
        && error.code === 'INVALID_REQUEST' && !error.retryable,
    );
  }
  assert.equal(calls, 0);
});

test('Stripe direct money-movement writes reject padded persisted references before network I/O', async () => {
  let calls = 0;
  const provider = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => { calls += 1; throw new Error('Unexpected network I/O.'); },
  });
  for (const reference of [' pi_owned', 'pi_owned ', '\tpi_owned', 'pi_owned\n']) {
    for (const operation of [
      () => provider.capturePayment!({ ...context('stripe:capture:noncanonical'), providerReference: reference }),
      () => provider.releaseAuthorization!({ ...context('stripe:release:noncanonical'), providerReference: reference }),
      () => provider.refundPayment!({ ...context('stripe:refund:noncanonical'), providerReference: reference }),
    ]) {
      await assert.rejects(operation(), (error: unknown) =>
        error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST');
    }
  }
  assert.equal(calls, 0);
});

test('Stripe write responses cannot substitute a different PaymentIntent or refund source', async () => {
  const capture = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(stripeJson({ id: 'pi_other', status: 'succeeded', amount: 24100, amount_received: 24100, currency: 'usd' })),
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
      fetchImpl: async () => new Response(stripeJson(refund)),
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
      fetchImpl: async () => new Response(stripeJson({ id: 'pi_authorized_1', status: 'succeeded', amount: 24100, amount_received: received, amount_capturable: 0, currency: 'usd' })),
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
    fetchImpl: async () => new Response(stripeJson({
      id: 'pi_received_1', status: 'succeeded', amount: 24100, amount_received: 24100, amount_capturable: 0, currency: 'usd',
    })),
  });
  const result = await authorized.authorizePayment!({ ...context('stripe:auth:proven'), paymentMethodReference: 'pm_card_1' });
  assert.equal(result.status, 'PAID');
  assert.equal(result.providerReference, 'pi_received_1');

  const release = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(stripeJson({
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
      fetchImpl: async () => new Response(stripeJson({
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
      fetchImpl: async () => new Response(stripeJson({
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
    fetchImpl: async () => new Response(stripeJson({
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
      fetchImpl: async () => new Response(stripeJson({
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
    fetchImpl: async () => new Response(stripeJson({
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
      fetchImpl: async () => new Response(stripeJson({
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
    fetchImpl: async () => new Response(stripeJson({
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
    fetchImpl: async () => new Response(stripeJson({
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
      fetchImpl: async () => new Response(stripeJson({
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
    fetchImpl: async () => new Response(stripeJson({
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
      fetchImpl: async () => new Response(stripeJson({
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
    fetchImpl: async () => new Response(stripeJson({
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
      fetchImpl: async () => new Response(stripeJson({
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
      fetchImpl: async () => new Response(stripeJson({
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
    fetchImpl: async () => new Response(stripeJson({
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
      fetchImpl: async () => new Response(stripeJson({
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
      fetchImpl: async () => new Response(stripeJson({
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
    fetchImpl: async () => new Response(stripeJson({
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
    fetchImpl: async () => new Response(stripeJson({
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
      fetchImpl: async (url) => new Response(stripeJson(String(url).endsWith('/refunds')
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
        fetchImpl: async () => new Response(stripeJson(payload), { status }),
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
      fetchImpl: async () => new Response(stripeJson({ error: { type: item.type } }), { status: item.status }),
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

test('Stripe money-movement writes reject missing or cross-tenant provider metadata', async () => {
  const wrongId = '33333333-3333-4333-8333-333333333333';
  const expectedMetadata = { sf_organization_id: organizationId, sf_booking_id: bookingId };
  const invalidMetadata: unknown[] = [
    undefined,
    null,
    [],
    {},
    { ...expectedMetadata, sf_organization_id: wrongId },
    { ...expectedMetadata, sf_booking_id: wrongId },
    { ...expectedMetadata, sf_booking_id: ` ${bookingId} ` },
    { ...expectedMetadata, sf_organization_id: organizationId.toUpperCase() },
  ];
  const operations = [
    {
      name: 'authorize',
      resource: { id: 'pi_owned_1', status: 'requires_capture', amount: 24100, amount_received: 0, amount_capturable: 24100, currency: 'usd' },
      run: (provider: StripePaymentProvider) => provider.authorizePayment!({ ...context('stripe:owned:authorize'), paymentMethodReference: 'pm_card_1' }),
    },
    {
      name: 'capture',
      resource: { id: 'pi_owned_1', status: 'succeeded', amount: 24100, amount_received: 12000, amount_capturable: 0, currency: 'usd' },
      run: (provider: StripePaymentProvider) => provider.capturePayment!({
        ...context('stripe:owned:capture'), providerReference: 'pi_owned_1', money: { currency: 'USD', amountMinor: 12000n },
      }),
    },
    {
      name: 'release',
      resource: { id: 'pi_owned_1', status: 'canceled', amount: 24100, amount_received: 0, amount_capturable: 0, currency: 'usd' },
      run: (provider: StripePaymentProvider) => provider.releaseAuthorization!({ ...context('stripe:owned:release'), providerReference: 'pi_owned_1' }),
    },
    {
      name: 'refund',
      resource: { id: 're_owned_1', payment_intent: 'pi_owned_1', status: 'pending', amount: 4100, currency: 'usd' },
      run: (provider: StripePaymentProvider) => provider.refundPayment!({
        ...context('stripe:owned:refund'), providerReference: 'pi_owned_1', money: { currency: 'USD', amountMinor: 4100n },
      }),
    },
  ] as const;

  for (const operation of operations) {
    for (const metadata of invalidMetadata) {
      const provider = new StripePaymentProvider({
        secretKey: 'sk_test_not-a-real-secret',
        fetchImpl: async () => new Response(JSON.stringify({ ...operation.resource, metadata }), { status: 200 }),
      });
      await assert.rejects(operation.run(provider), (error: unknown) => (
        error instanceof PaymentProviderError
        && error.code === 'UNKNOWN'
        && error.retryable
        && /ownership evidence/.test(error.message)
      ), `${operation.name} must not accept provider metadata ${JSON.stringify(metadata)}`);
    }
  }
});

test('Stripe money-movement adapters reject invalid write identity and money before provider I/O', async () => {
  assert.notEqual(organizationId.toUpperCase(), organizationId);
  let calls = 0;
  const provider = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('Provider must not be contacted for invalid input.');
    },
  });
  const invalidInputs: ReadonlyArray<Record<string, unknown>> = [
    { organizationId: organizationId.toUpperCase() },
    { organizationId: ` ${organizationId}` },
    { bookingId: `${bookingId} ` },
    { idempotencyKey: ' stripe:payment:1 ' },
    { idempotencyKey: 'short' },
    { money: { currency: 'usd', amountMinor: 24100n } },
    { money: { currency: ' USD ', amountMinor: 24100n } },
    { money: { currency: 'USD', amountMinor: 0n } },
    { money: { currency: 'USD', amountMinor: -1n } },
    { money: { currency: 'USD', amountMinor: Number.MAX_SAFE_INTEGER + 1 } },
    { money: { currency: 'USD', amountMinor: BigInt(Number.MAX_SAFE_INTEGER) + 1n } },
  ];
  for (const overrides of invalidInputs) {
    const input = { ...context(), ...overrides };
    const operations = [
      () => provider.authorizePayment({ ...input, paymentMethodReference: 'pm_card_1' } as Parameters<StripePaymentProvider['authorizePayment']>[0]),
      () => provider.capturePayment({ ...input, providerReference: 'pi_owned_1' } as Parameters<StripePaymentProvider['capturePayment']>[0]),
      () => provider.releaseAuthorization({ ...input, providerReference: 'pi_owned_1' } as Parameters<StripePaymentProvider['releaseAuthorization']>[0]),
      () => provider.refundPayment({ ...input, providerReference: 'pi_owned_1' } as Parameters<StripePaymentProvider['refundPayment']>[0]),
    ];
    for (const operation of operations) {
      await assert.rejects(operation(), (error: unknown) =>
        error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST' && !error.retryable);
    }
  }
  assert.equal(calls, 0);
});
