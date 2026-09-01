import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { PaymentProviderError } from './payment-provider.ts';
import {
  StripePaymentProvider,
  normalizeStripePaymentIntentReference,
  normalizeStripePaymentMethodReference,
  type StripeFetch,
} from './stripe-payment-provider.ts';

const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';

function context(idempotencyKey = 'stripe:payment:1') {
  return {
    organizationId,
    bookingId,
    idempotencyKey,
    money: { currency: 'USD', amountMinor: 24100n },
  } as const;
}

test('stripe adapter authorizes with manual capture and server-owned metadata', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const fetchImpl: StripeFetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ id: 'pi_authorized_1', status: 'requires_capture', amount: 24100, currency: 'usd' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const provider = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret', fetchImpl });
  const result = await provider.authorizePayment!({ ...context(), paymentMethodReference: 'pm_card_1' });

  assert.deepEqual([...provider.capabilities], ['AUTHORIZE', 'CAPTURE', 'REFUND', 'WEBHOOKS']);
  assert.equal(requestUrl, 'https://api.stripe.com/v1/payment_intents');
  assert.equal(new Headers(requestInit?.headers).get('authorization'), 'Bearer sk_test_not-a-real-secret');
  assert.equal(new Headers(requestInit?.headers).get('idempotency-key'), 'stripe:payment:1');
  const form = new URLSearchParams(String(requestInit?.body));
  assert.equal(form.get('amount'), '24100');
  assert.equal(form.get('currency'), 'usd');
  assert.equal(form.get('payment_method'), 'pm_card_1');
  assert.equal(form.get('capture_method'), 'manual');
  assert.equal(form.get('confirm'), 'true');
  assert.equal(form.get('metadata[sf_organization_id]'), organizationId);
  assert.equal(form.get('metadata[sf_booking_id]'), bookingId);
  assert.deepEqual(result, {
    providerCode: 'stripe',
    providerReference: 'pi_authorized_1',
    status: 'AUTHORIZED',
    money: { currency: 'USD', amountMinor: 24100n },
  });
});

test('stripe adapter captures and refunds exact minor-unit amounts idempotently', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: StripeFetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith('/capture')) {
      return new Response(JSON.stringify({ id: 'pi_capture_1', status: 'succeeded', amount: 24100, currency: 'usd' }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 're_refund_1', payment_intent: 'pi_capture_1', status: 'succeeded', amount: 4100, currency: 'usd' }), { status: 200 });
  };

  const provider = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret', fetchImpl });
  const captured = await provider.capturePayment!({ ...context('stripe:capture:1'), providerReference: 'pi_capture_1' });
  const refunded = await provider.refundPayment!({
    ...context('stripe:refund:1'),
    money: { currency: 'USD', amountMinor: 4100n },
    providerReference: 'pi_capture_1',
  });

  assert.equal(captured.status, 'PAID');
  assert.equal(new URLSearchParams(String(requests[0]?.init?.body)).get('amount_to_capture'), '24100');
  assert.equal(new Headers(requests[0]?.init?.headers).get('idempotency-key'), 'stripe:capture:1');
  assert.equal(refunded.status, 'REFUNDED');
  assert.equal(refunded.refundReference, 're_refund_1');
  assert.equal(new URLSearchParams(String(requests[1]?.init?.body)).get('amount'), '4100');
  assert.equal(new Headers(requests[1]?.init?.headers).get('idempotency-key'), 'stripe:refund:1');
});

test('stripe adapter normalizes provider failures and rejects mismatched money', async () => {
  const declined = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({ error: { type: 'card_error', code: 'card_declined', message: 'Card declined' } }), { status: 402 }),
  });
  await assert.rejects(declined.authorizePayment!({ ...context(), paymentMethodReference: 'pm_card_1' }), (error: unknown) => {
    assert.equal(error instanceof PaymentProviderError, true);
    assert.equal((error as PaymentProviderError).code, 'DECLINED');
    assert.equal((error as PaymentProviderError).retryable, false);
    return true;
  });

  const rateLimited = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Slow down' } }), { status: 429 }),
  });
  await assert.rejects(rateLimited.authorizePayment!({ ...context(), paymentMethodReference: 'pm_card_1' }), (error: unknown) => {
    assert.equal((error as PaymentProviderError).code, 'RATE_LIMITED');
    assert.equal((error as PaymentProviderError).retryable, true);
    return true;
  });

  const mismatched = new StripePaymentProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({ id: 'pi_wrong_amount', status: 'requires_capture', amount: 1, currency: 'usd' }), { status: 200 }),
  });
  await assert.rejects(mismatched.authorizePayment!({ ...context(), paymentMethodReference: 'pm_card_1' }), /does not match/);
});

test('stripe webhook verification checks signed raw payload and timestamp tolerance', () => {
  const provider = new StripePaymentProvider({ secretKey: 'sk_test_not-a-real-secret' });
  const payload = '{"id":"evt_1","type":"payment_intent.succeeded"}';
  const secret = 'whsec_test_signing_secret';
  const timestamp = 1_800_000_000;
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');

  assert.equal(
    provider.verifyWebhookSignature!({ payload, signature: `t=${timestamp},v1=${signature}`, secret, now: new Date(timestamp * 1000) }),
    true,
  );
  assert.equal(
    provider.verifyWebhookSignature!({ payload: `${payload} `, signature: `t=${timestamp},v1=${signature}`, secret, now: new Date(timestamp * 1000) }),
    false,
  );
  assert.equal(
    provider.verifyWebhookSignature!({ payload, signature: `t=${timestamp},v1=${signature}`, secret, now: new Date((timestamp + 301) * 1000) }),
    false,
  );
});

test('stripe references and constructor configuration are validated before requests', () => {
  assert.equal(normalizeStripePaymentIntentReference(' pi_valid_1 '), 'pi_valid_1');
  assert.equal(normalizeStripePaymentMethodReference(' pm_valid_1 '), 'pm_valid_1');
  assert.throws(() => normalizeStripePaymentIntentReference('ch_wrong'), /PaymentIntent reference/);
  assert.throws(() => normalizeStripePaymentMethodReference('card_wrong'), /payment method reference/);
  assert.throws(() => new StripePaymentProvider({ secretKey: 'not-a-key' }), /secret key/);
  assert.throws(() => new StripePaymentProvider({ secretKey: 'sk_test_valid-enough', timeoutMs: 99 }), /timeout/);
});
