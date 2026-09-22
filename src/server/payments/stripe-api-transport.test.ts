import assert from 'node:assert/strict';
import test from 'node:test';

import { PaymentProviderError } from './payment-provider.ts';
import { requestStripeApi } from './stripe-api-transport.ts';

function capturingFetch(capture: { input?: RequestInfo | URL; init?: RequestInit }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    capture.input = input;
    capture.init = init;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

test('Stripe POST transport owns redirect, credential, cache, referrer, and connection policy', async () => {
  const capture: { input?: RequestInfo | URL; init?: RequestInit } = {};
  const controller = new AbortController();
  const callerInit = {
    method: 'POST',
    headers: {
      Authorization: 'Bearer sk_test_not-a-real-secret',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': 'sf:test:12345678',
    },
    body: 'amount=100&currency=usd',
    signal: controller.signal,
    cache: 'force-cache',
    credentials: 'include',
    redirect: 'follow',
    referrer: 'https://example.invalid/leak',
    referrerPolicy: 'unsafe-url',
    keepalive: true,
    dispatcher: { unsafe: true },
    next: { revalidate: 60 },
  } as RequestInit & { dispatcher: object; next: object };

  await requestStripeApi(
    capturingFetch(capture),
    'https://api.stripe.com/v1/payment_intents',
    callerInit,
  );

  assert.equal(capture.input, 'https://api.stripe.com/v1/payment_intents');
  assert.equal(capture.init?.method, 'POST');
  assert.equal(capture.init?.body, 'amount=100&currency=usd');
  assert.equal(capture.init?.signal, controller.signal);
  assert.equal(capture.init?.cache, 'no-store');
  assert.equal(capture.init?.credentials, 'omit');
  assert.equal(capture.init?.redirect, 'manual');
  assert.equal(capture.init?.referrer, '');
  assert.equal(capture.init?.referrerPolicy, 'no-referrer');
  assert.equal(capture.init?.keepalive, false);
  assert.equal((capture.init as Record<string, unknown>).dispatcher, undefined);
  assert.equal((capture.init as Record<string, unknown>).next, undefined);
  const headers = new Headers(capture.init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer sk_test_not-a-real-secret');
  assert.equal(headers.get('idempotency-key'), 'sf:test:12345678');
});

test('Stripe GET transport permits only reviewed read endpoints and no request body', async () => {
  const capture: { input?: RequestInfo | URL; init?: RequestInit } = {};
  await requestStripeApi(capturingFetch(capture), 'https://api.stripe.com/v1/balance', {
    method: 'GET',
    headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
  });
  assert.equal(capture.init?.method, 'GET');
  assert.equal(capture.init?.body, undefined);
  assert.equal(capture.init?.redirect, 'manual');
  assert.equal(capture.init?.credentials, 'omit');
});

test('Stripe transport rejects targets and operations outside the implemented API surface', async () => {
  const fetchImpl = capturingFetch({});
  const getInit = { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } } as const;
  assert.throws(
    () => requestStripeApi(fetchImpl, 'http://api.stripe.com/v1/balance', getInit),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST' && error.retryable === false,
  );
  assert.throws(() => requestStripeApi(fetchImpl, 'https://example.com/v1/balance', getInit));
  assert.throws(() => requestStripeApi(fetchImpl, 'https://api.stripe.com:444/v1/balance', getInit));
  assert.throws(() => requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance?expand=available', getInit));
  assert.throws(() => requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/customers', getInit));
  assert.throws(() => requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', { ...getInit, method: 'DELETE' }));
});

test('Stripe transport rejects unreviewed headers and missing POST idempotency authority', async () => {
  const fetchImpl = capturingFetch({});
  assert.throws(() => requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', {
    method: 'GET',
    headers: {
      Authorization: 'Bearer sk_test_not-a-real-secret',
      Cookie: 'session=ambient',
    },
  }));
  assert.throws(() => requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer sk_test_not-a-real-secret',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'payment_intent=pi_123',
  }));
});

test('Stripe transport allowlist covers exactly the currently implemented adapter endpoint shapes', async () => {
  const fetchImpl = capturingFetch({});
  const authorization = { Authorization: 'Bearer sk_test_not-a-real-secret' };
  const getPaths = [
    '/v1/balance',
    '/v1/payment_intents/pi_123',
    '/v1/refunds/re_123',
    '/v1/checkout/sessions/cs_123',
  ];
  for (const path of getPaths) {
    await requestStripeApi(fetchImpl, `https://api.stripe.com${path}`, { method: 'GET', headers: authorization });
  }

  const postPaths = [
    '/v1/payment_intents',
    '/v1/payment_intents/pi_123/capture',
    '/v1/payment_intents/pi_123/cancel',
    '/v1/refunds',
    '/v1/checkout/sessions',
  ];
  for (const path of postPaths) {
    await requestStripeApi(fetchImpl, `https://api.stripe.com${path}`, {
      method: 'POST',
      headers: {
        ...authorization,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `sf:test:${path.length}:12345678`,
      },
      body: 'test=value',
    });
  }
});
