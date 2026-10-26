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

function stripePostInit(body = 'amount=100&currency=usd'): RequestInit {
  return {
    method: 'POST',
    headers: {
      Authorization: 'Bearer sk_test_not-a-real-secret',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': 'sf:test:12345678',
    },
    body,
  };
}

test('Stripe POST transport owns redirect, credential, cache, referrer, connection, and integrity policy', async () => {
  const capture: { input?: RequestInfo | URL; init?: RequestInit } = {};
  const controller = new AbortController();
  const callerInit = {
    ...stripePostInit(),
    signal: controller.signal,
    cache: 'force-cache',
    credentials: 'include',
    redirect: 'follow',
    referrer: 'https://example.invalid/leak',
    referrerPolicy: 'unsafe-url',
    keepalive: true,
    integrity: 'sha256-not-provider-authority',
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
  assert.equal(capture.init?.integrity, '');
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

test('Stripe transport rejects unreviewed headers, missing POST idempotency authority, and oversized request bodies', async () => {
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
  assert.throws(
    () => requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/refunds', stripePostInit(`x=${'a'.repeat(256 * 1024)}`)),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST' && error.retryable === false,
  );
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

test('Stripe transport buffers bounded response bodies and returns an unread replay without wire representation metadata', async () => {
  const fetchImpl = (async () => new Response('abc', {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-length': '3',
      'content-encoding': 'gzip',
      'stripe-version': '2026-08-27.basil',
    },
  })) as typeof fetch;

  const response = await requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', {
    method: 'GET',
    headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
  });

  assert.equal(response.bodyUsed, false);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(response.headers.get('stripe-version'), '2026-08-27.basil');
  assert.equal(await response.text(), 'abc');
});

test('Stripe transport rejects malformed or oversized declared response lengths as retryable unknown provider evidence', async () => {
  const getInit = { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } } as const;
  for (const value of ['invalid', '-1', String(4 * 1024 * 1024 + 1)]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = (async () => new Response(body, { status: 200, headers: { 'content-length': value } })) as typeof fetch;
    await assert.rejects(
      requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', getInit),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(cancelled, true);
  }
});

test('Stripe transport enforces the response ceiling on streamed bytes even without Content-Length', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4 * 1024 * 1024));
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetchImpl = (async () => new Response(body, { status: 200 })) as typeof fetch;

  await assert.rejects(
    requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
    }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true,
  );
  assert.equal(cancelled, true);
});

test('Stripe transport cancels non-byte response chunks as retryable unknown provider evidence', async () => {
  const getInit = { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } } as const;
  const malformedChunks: unknown[] = ['{"ok":true}', undefined, new DataView(new ArrayBuffer(2))];
  for (const chunk of malformedChunks) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk as Uint8Array);
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = (async () => new Response(body, { status: 200 })) as typeof fetch;
    await assert.rejects(
      requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', getInit),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true,
    );
    assert.equal(cancelled, true);
  }
});

test('Stripe transport releases the response reader and classifies failed reads as unknown provider evidence', async () => {
  const failure = new Error('provider stream read failed');
  let cancelled = 0;
  let released = 0;
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, 'body', {
    value: {
      getReader() {
        return {
          async read() {
            throw failure;
          },
          async cancel() {
            cancelled += 1;
          },
          releaseLock() {
            released += 1;
          },
        };
      },
    },
  });
  const fetchImpl = (async () => response) as typeof fetch;
  await assert.rejects(
    requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
    }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true && !error.message.includes(failure.message),
  );
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});


test('Stripe transport treats locked response bodies as retryable unknown provider evidence', async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); } });
  const response = new Response(body, { status: 200 });
  const heldReader = response.body!.getReader();
  try {
    await assert.rejects(
      requestStripeApi((async () => response) as typeof fetch,
        'https://api.stripe.com/v1/balance',
        { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true,
    );
  } finally {
    heldReader.releaseLock();
    await body.cancel();
  }
});

test('Stripe transport preserves a real timeout over malformed provider response headers', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(stream) { stream.enqueue(new Uint8Array([1])); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(
    requestStripeApi((async () => {
      controller.abort();
      return new Response(body, { status: 200, headers: { 'content-length': 'invalid' } });
    }) as typeof fetch, 'https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});

test('Stripe transport normalizes throwing provider response headers without leaking their error', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(stream) { stream.enqueue(new Uint8Array([1])); },
    cancel() { cancelled = true; },
  });
  const response = new Response(body, { status: 200 });
  Object.defineProperty(response, 'headers', { get() { throw new Error('raw provider metadata'); } });
  await assert.rejects(
    requestStripeApi((async () => response) as typeof fetch, 'https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
    }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true && !error.message.includes('raw provider metadata'),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});

test('Stripe transport ignores synchronous cancellation failures when declared length is invalid', async () => {
  const response = new Response(null, { status: 200, headers: { 'content-length': 'bad' } });
  Object.defineProperty(response, 'body', {
    value: { cancel() { throw new Error('cancellation failed'); } },
  });
  await assert.rejects(
    requestStripeApi((async () => response) as typeof fetch, 'https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
    }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true,
  );
});

test('Stripe transport normalizes malformed replay metadata after buffering', async () => {
  const response = new Response('body', { status: 200 });
  Object.defineProperty(response, 'status', { get() { throw new Error('untrusted status'); } });
  await assert.rejects(
    requestStripeApi((async () => response) as typeof fetch, 'https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
    }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true && !error.message.includes('untrusted status'),
  );
});

test('Stripe transport normalizes reader lock-release failures without exposing raw provider errors', async () => {
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, 'body', {
    value: {
      getReader() {
        return {
          async read() { return { done: true, value: undefined }; },
          releaseLock() { throw new Error('untrusted release error'); },
        };
      },
    },
  });
  await assert.rejects(
    requestStripeApi((async () => response) as typeof fetch, 'https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
    }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true && !error.message.includes('untrusted release error'),
  );
});

test('Stripe transport times out while Fetch itself is stalled and ignores the native signal', async () => {
  const controller = new AbortController();
  let resolveFetch: ((response: Response) => void) | undefined;
  const fetchImpl = (() => new Promise<Response>((resolve) => { resolveFetch = resolve; })) as typeof fetch;
  const request = requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', {
    method: 'GET',
    headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(request, (error: unknown) => error instanceof Error && error.name === 'AbortError');

  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() { cancelled = true; },
  });
  resolveFetch!(new Response(body, { status: 200 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true, 'late Fetch responses must not leave a body stream active');
});

test('Stripe transport consumes late Fetch rejections after a caller-owned timeout', async () => {
  const controller = new AbortController();
  let rejectFetch: ((error: Error) => void) | undefined;
  const fetchImpl = (() => new Promise<Response>((_resolve, reject) => { rejectFetch = reject; })) as typeof fetch;
  const request = requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', {
    method: 'GET',
    headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(request, (error: unknown) => error instanceof Error && error.name === 'AbortError');
  rejectFetch!(new Error('late injected Fetch rejection'));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('Stripe Fetch acquisition uses native signal authority despite shadowed instance fields', async () => {
  const controller = new AbortController();
  Object.defineProperty(controller.signal, 'aborted', { get: () => true });
  Object.defineProperty(controller.signal, 'addEventListener', { value: () => { throw new Error('shadowed listener'); } });
  Object.defineProperty(controller.signal, 'removeEventListener', { value: () => { throw new Error('shadowed listener'); } });
  const response = await requestStripeApi(
    (async () => new Response('{"ok":true}')) as typeof fetch,
    'https://api.stripe.com/v1/balance',
    {
      method: 'GET',
      headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
      signal: controller.signal,
    },
  );
  assert.deepEqual(await response.json(), { ok: true });
});

test('Stripe transport keeps caller abort authority active through response body acquisition', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetchImpl = (async () => new Response(body, { status: 200 })) as typeof fetch;
  const controller = new AbortController();
  const request = requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', {
    method: 'GET',
    headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 5);

  await assert.rejects(request, (error: unknown) => error instanceof Error && error.name === 'AbortError');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});

test('Stripe transport rejects non-Response values from injected transports as retryable unknown provider evidence', async () => {
  const fetchImpl = (async () => ({ ok: true })) as unknown as typeof fetch;
  await assert.rejects(
    requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
    }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true,
  );
});

test('Stripe transport snapshots request body, signal, method, and headers once before provider I/O', async () => {
  const capture: { input?: RequestInfo | URL; init?: RequestInit } = {};
  const controller = new AbortController();
  const init = stripePostInit();
  const reads = { method: 0, body: 0, signal: 0, headers: 0 };
  Object.defineProperties(init, {
    method: {
      get() {
        reads.method += 1;
        return reads.method === 1 ? 'POST' : 'DELETE';
      },
    },
    body: {
      get() {
        reads.body += 1;
        return reads.body === 1 ? 'amount=100&currency=usd' : new Uint8Array([1, 2, 3]);
      },
    },
    signal: {
      get() {
        reads.signal += 1;
        return reads.signal === 1 ? controller.signal : { aborted: false };
      },
    },
    headers: {
      get() {
        reads.headers += 1;
        return reads.headers === 1
          ? { Authorization: 'Bearer sk_test_not-a-real-secret', 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': 'sf:test:12345678' }
          : { Authorization: 'Bearer sk_test_different-secret' };
      },
    },
  });

  await requestStripeApi(capturingFetch(capture), 'https://api.stripe.com/v1/payment_intents', init);
  assert.deepEqual(reads, { method: 1, body: 1, signal: 1, headers: 1 });
  assert.equal(capture.init?.method, 'POST');
  assert.equal(capture.init?.body, 'amount=100&currency=usd');
  assert.equal(capture.init?.signal, controller.signal);
  assert.equal(new Headers(capture.init?.headers).get('authorization'), 'Bearer sk_test_not-a-real-secret');
});

test('Stripe transport rejects forged signals before network I/O and preserves pre-aborted timeout evidence', () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}');
  }) as typeof fetch;
  const getInit = { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } };
  for (const signal of [{ aborted: false }, { aborted: true }, Object.create(AbortSignal.prototype)]) {
    assert.throws(
      () => requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', {
        ...getInit,
        signal: signal as AbortSignal,
      }),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST' && !error.retryable,
    );
  }

  const controller = new AbortController();
  Object.defineProperty(controller.signal, 'aborted', { get: () => false });
  controller.abort();
  assert.throws(
    () => requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', {
      ...getInit,
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
  assert.equal(calls, 0);
});

test('Stripe transport normalizes throwing RequestInit getters without reaching the provider', () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}');
  }) as typeof fetch;
  for (const key of ['method', 'body', 'signal', 'headers'] as const) {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sk_test_not-a-real-secret',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': 'sf:test:12345678',
      },
      body: 'amount=100&currency=usd',
    };
    Object.defineProperty(init, key, {
      get() { throw new Error('untrusted caller getter'); },
    });
    assert.throws(
      () => requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/payment_intents', init),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST' && !error.retryable,
    );
  }
  assert.equal(calls, 0);
});

test('Stripe body acquisition ignores shadowed native signal fields', async () => {
  const controller = new AbortController();
  Object.defineProperty(controller.signal, 'aborted', { get: () => true });
  Object.defineProperty(controller.signal, 'addEventListener', { value: () => { throw new Error('shadowed listener'); } });
  Object.defineProperty(controller.signal, 'removeEventListener', { value: () => { throw new Error('shadowed listener'); } });
  const response = await requestStripeApi(
    (async () => new Response('{"ok":true}', { status: 200 })) as typeof fetch,
    'https://api.stripe.com/v1/balance',
    {
      method: 'GET',
      headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
      signal: controller.signal,
    },
  );
  assert.deepEqual(await response.json(), { ok: true });
});

test('Stripe body acquisition honors real abort despite shadowed signal fields', async () => {
  const controller = new AbortController();
  Object.defineProperty(controller.signal, 'aborted', { get: () => false });
  Object.defineProperty(controller.signal, 'addEventListener', { value: () => undefined });
  Object.defineProperty(controller.signal, 'removeEventListener', { value: () => undefined });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull() { return new Promise<void>(() => undefined); },
    cancel() { cancelled = true; },
  });
  const request = requestStripeApi(
    (async () => new Response(body, { status: 200 })) as typeof fetch,
    'https://api.stripe.com/v1/balance',
    {
      method: 'GET',
      headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
      signal: controller.signal,
    },
  );
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(request, (error: unknown) => error instanceof Error && error.name === 'AbortError');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});

test('Stripe transport replays null-body responses through reviewed metadata', async () => {
  const original = new Response(null, {
    status: 204,
    headers: {
      'content-length': '0',
      'content-encoding': 'gzip',
      'stripe-version': '2026-08-27.basil',
    },
  });
  const response = await requestStripeApi(
    (async () => original) as typeof fetch,
    'https://api.stripe.com/v1/balance',
    { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } },
  );
  assert.notEqual(response, original);
  assert.equal(response.status, 204);
  assert.equal(response.body, null);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(response.headers.get('stripe-version'), '2026-08-27.basil');
});

test('Stripe transport rejects malformed null-body response status without leaking provider errors', async () => {
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, 'status', { get() { throw new Error('upstream null-body status'); } });
  await assert.rejects(
    requestStripeApi((async () => response) as typeof fetch,
      'https://api.stripe.com/v1/balance',
      { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } }),
    (error: unknown) => error instanceof PaymentProviderError
      && error.code === 'UNKNOWN'
      && error.retryable === true
      && !error.message.includes('upstream null-body status'),
  );
});

test('Stripe transport honors a deadline expiring during null-body acquisition', async () => {
  const controller = new AbortController();
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, 'body', {
    get() {
      controller.abort();
      return null;
    },
  });
  await assert.rejects(
    requestStripeApi((async () => response) as typeof fetch,
      'https://api.stripe.com/v1/balance',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
        signal: controller.signal,
      }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
});

test('Stripe transport copies native byte chunks despite shadowed length and slice accessors', async () => {
  const chunk = new Uint8Array([1, 2, 3]);
  Object.defineProperty(chunk, 'byteLength', { get() { return 0; } });
  Object.defineProperty(chunk, 'slice', { value() { throw new Error('shadowed slice'); } });
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(chunk); controller.close(); },
  });
  const response = await requestStripeApi(
    (async () => new Response(body, { status: 200 })) as typeof fetch,
    'https://api.stripe.com/v1/balance',
    { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } },
  );
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test('Stripe transport enforces the native byte length when a chunk shadows its size', async () => {
  const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
  Object.defineProperty(oversized, 'byteLength', { get() { return 0; } });
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(oversized); },
  });
  await assert.rejects(
    requestStripeApi((async () => new Response(body, { status: 200 })) as typeof fetch,
      'https://api.stripe.com/v1/balance',
      { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true,
  );
});


test('Stripe transport rejects endless zero-byte chunks without unbounded allocations', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(0)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(
    requestStripeApi((async () => new Response(body)) as typeof fetch,
      'https://api.stripe.com/v1/balance',
      { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true,
  );
  assert.equal(cancelled, true);
});

test('Stripe transport rejects excessive tiny chunks below the byte ceiling', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array([123])); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(
    requestStripeApi((async () => new Response(body)) as typeof fetch,
      'https://api.stripe.com/v1/balance',
      { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } }),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable === true,
  );
  assert.equal(cancelled, true);
});

test('Stripe transport preserves exact bytes across bounded buffer growth', async () => {
  const expected = new Uint8Array(5_000);
  for (let index = 0; index < expected.length; index += 1) expected[index] = index % 251;
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === expected.length) { controller.close(); return; }
      controller.enqueue(expected.subarray(offset, ++offset));
    },
  });
  const response = await requestStripeApi(
    (async () => new Response(body)) as typeof fetch,
    'https://api.stripe.com/v1/balance',
    { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } },
  );
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected);
});

test('Stripe response transport snapshots one-shot read-result accessors with and without abort signals', async () => {
  for (const withSignal of [false, true]) {
    const bytes = new TextEncoder().encode('{"ok":true}');
    let doneReads = 0;
    let valueReads = 0;
    let reads = 0;
    const reader = {
      read() {
        reads += 1;
        if (reads > 1) {
          return Promise.resolve({
            done: true,
            get value() { throw new Error('completed result value must not be read'); },
          });
        }
        return Promise.resolve({
          get done() {
            doneReads += 1;
            if (doneReads > 1) throw new Error('repeated done getter');
            return false;
          },
          get value() {
            valueReads += 1;
            if (valueReads > 1) throw new Error('repeated value getter');
            return bytes;
          },
        });
      },
      cancel() { throw new Error('unexpected cancellation'); },
      releaseLock() {},
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;
    const upstream = new Response('{}');
    Object.defineProperty(upstream, 'body', { value: { getReader: () => reader } });
    const response = await requestStripeApi(
      (async () => upstream) as typeof fetch,
      'https://api.stripe.com/v1/balance',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
        ...(withSignal ? { signal: new AbortController().signal } : {}),
      },
    );
    assert.equal(await response.text(), '{"ok":true}');
    assert.equal(doneReads, 1);
    assert.equal(valueReads, 1);
    assert.equal(reads, 2);
  }
});

test('Stripe response transport classifies malformed read results as retryable unknown evidence', async () => {
  for (const withSignal of [false, true]) {
    for (const result of [undefined, { done: false }, { get done() { throw new Error('private provider error'); } }]) {
      let cancellations = 0;
      const reader = {
        read() { return Promise.resolve(result); },
        cancel() { cancellations += 1; return Promise.resolve(); },
        releaseLock() {},
      } as unknown as ReadableStreamDefaultReader<Uint8Array>;
      const upstream = new Response('{}');
      Object.defineProperty(upstream, 'body', { value: { getReader: () => reader } });
      await assert.rejects(
        requestStripeApi(
          (async () => upstream) as typeof fetch,
          'https://api.stripe.com/v1/balance',
          {
            method: 'GET',
            headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
            ...(withSignal ? { signal: new AbortController().signal } : {}),
          },
        ),
        (error: unknown) => error instanceof PaymentProviderError
          && error.code === 'UNKNOWN'
          && error.retryable === true
          && !error.message.includes('private provider error'),
      );
      assert.equal(cancellations, 1);
    }
  }
});


test('Stripe response metadata is read once for streamed and bodyless provider responses', async () => {
  for (const bodyless of [false, true]) {
    const upstream = new Response(bodyless ? null : '{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-provider-snapshot': 'original' },
    });
    const snapshot = {
      body: upstream.body,
      headers: upstream.headers,
      status: upstream.status,
      statusText: upstream.statusText,
    };
    const reads = new Map<string, number>();
    for (const [key, value] of Object.entries(snapshot)) {
      Object.defineProperty(upstream, key, {
        configurable: true,
        get() {
          const count = (reads.get(key) ?? 0) + 1;
          reads.set(key, count);
          if (count > 1) throw new Error('Provider response metadata was read twice.');
          return value;
        },
      });
    }
    const response = await requestStripeApi(
      (async () => upstream) as typeof fetch,
      'https://api.stripe.com/v1/balance',
      { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } },
    );
    assert.notEqual(response, upstream);
    assert.equal(response.headers.get('x-provider-snapshot'), 'original');
    assert.equal(await response.text(), bodyless ? '' : '{}');
    for (const key of Object.keys(snapshot)) assert.equal(reads.get(key), 1, key);
  }
});

test('Stripe replay keeps the validated header snapshot when upstream metadata changes during reads', async () => {
  const upstream = new Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-length': '2', 'x-provider-snapshot': 'original' },
  });
  const mutableHeaders = upstream.headers;
  let readCount = 0;
  Object.defineProperty(upstream, 'body', {
    value: {
      getReader() {
        return {
          read() {
            readCount += 1;
            if (readCount === 1) {
              mutableHeaders.set('x-provider-snapshot', 'tampered');
              mutableHeaders.set('content-length', '999999999');
              return Promise.resolve({ done: false, value: new TextEncoder().encode('{}') });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
          releaseLock() {},
        };
      },
    },
  });
  const response = await requestStripeApi(
    (async () => upstream) as typeof fetch,
    'https://api.stripe.com/v1/balance',
    { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } },
  );
  assert.equal(response.headers.get('x-provider-snapshot'), 'original');
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(await response.text(), '{}');
});

test('Stripe response metadata failures cancel the captured stream without reading the body twice', async () => {
  for (const field of ['headers', 'status', 'statusText', 'declared-length'] as const) {
    let bodyReads = 0;
    let cancellations = 0;
    const stream = new ReadableStream<Uint8Array>({
      cancel() { cancellations += 1; },
    });
    const upstream = new Response(stream, {
      status: 200,
      headers: field === 'declared-length' ? { 'content-length': 'invalid' } : undefined,
    });
    Object.defineProperty(upstream, 'body', {
      get() {
        bodyReads += 1;
        if (bodyReads > 1) throw new Error('Private second body access.');
        return stream;
      },
    });
    if (field !== 'declared-length') {
      Object.defineProperty(upstream, field, {
        get() { throw new Error('Private provider metadata error.'); },
      });
    }
    await assert.rejects(
      requestStripeApi(
        (async () => upstream) as typeof fetch,
        'https://api.stripe.com/v1/balance',
        { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } },
      ),
      (error: unknown) => error instanceof PaymentProviderError
        && error.code === 'UNKNOWN'
        && error.retryable === true
        && !error.message.includes('Private'),
    );
    assert.equal(bodyReads, 1, field);
    assert.equal(cancellations, 1, field);
  }
});

test('Stripe bodyless responses reject positive declared lengths except legal HTTP 304 metadata', async () => {
  for (const status of [200, 204]) {
    await assert.rejects(
      requestStripeApi(
        (async () => new Response(null, { status, headers: { 'content-length': '2' } })) as typeof fetch,
        'https://api.stripe.com/v1/balance',
        { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } },
      ),
      (error: unknown) => error instanceof PaymentProviderError
        && error.code === 'UNKNOWN'
        && error.retryable === true,
    );
  }
  const response = await requestStripeApi(
    (async () => new Response(null, {
      status: 304,
      headers: { 'content-length': '2', 'content-encoding': 'gzip' },
    })) as typeof fetch,
    'https://api.stripe.com/v1/balance',
    { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } },
  );
  assert.equal(response.status, 304);
  assert.equal(response.body, null);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('content-encoding'), null);
});

test('Stripe native abort authority outranks metadata errors during response snapshot', async () => {
  const controller = new AbortController();
  const upstream = new Response(null, { status: 200 });
  Object.defineProperty(upstream, 'status', {
    get() {
      controller.abort();
      throw new Error('Private provider status failure.');
    },
  });
  await assert.rejects(
    requestStripeApi(
      (async () => upstream) as typeof fetch,
      'https://api.stripe.com/v1/balance',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
        signal: controller.signal,
      },
    ),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
});

test('Stripe bodyless declared-length validation preserves an abort triggered during metadata snapshot', async () => {
  const controller = new AbortController();
  const upstream = new Response(null, {
    status: 200,
    headers: { 'content-length': '2' },
  });
  Object.defineProperty(upstream, 'body', {
    get() {
      controller.abort();
      return null;
    },
  });
  await assert.rejects(
    requestStripeApi(
      (async () => upstream) as typeof fetch,
      'https://api.stripe.com/v1/balance',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
        signal: controller.signal,
      },
    ),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
});

test('Stripe rejects incomplete or contradictory unencoded provider response lengths', async () => {
  const init = { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } };
  for (const declaredLength of ['0', '1', '3']) {
    const fetchImpl = (async () => new Response('{}', {
      headers: { 'content-length': declaredLength },
    })) as typeof fetch;
    await assert.rejects(
      requestStripeApi(fetchImpl, 'https://api.stripe.com/v1/balance', init),
      (error: unknown) => error instanceof PaymentProviderError
        && error.code === 'UNKNOWN' && error.retryable === true,
      `declared ${declaredLength} bytes for a 2-byte identity response`,
    );
  }
});

test('Stripe permits encoded wire lengths different from decoded Fetch response bytes', async () => {
  const response = await requestStripeApi(
    (async () => new Response('{"ok":true}', {
      headers: { 'content-length': '3', 'content-encoding': 'gzip' },
    })) as typeof fetch,
    'https://api.stripe.com/v1/balance',
    { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } },
  );
  assert.equal(await response.text(), '{"ok":true}');
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('content-encoding'), null);
});

test('Stripe local abort takes precedence over a response-length mismatch', async () => {
  const controller = new AbortController();
  const upstream = new Response('{}', { headers: { 'content-length': '3' } });
  Object.defineProperty(upstream, 'body', {
    get() {
      controller.abort();
      return new Response('{}').body;
    },
  });
  await assert.rejects(
    requestStripeApi(
      (async () => upstream) as typeof fetch,
      'https://api.stripe.com/v1/balance',
      { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' }, signal: controller.signal },
    ),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
});

test('Stripe treats explicit identity coding as unencoded response-length evidence', async () => {
  const init = { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } };
  for (const coding of ['identity', 'IDENTITY', 'identity, identity']) {
    await assert.rejects(
      requestStripeApi(
        (async () => new Response('{}', {
          headers: { 'content-length': '3', 'content-encoding': coding },
        })) as typeof fetch,
        'https://api.stripe.com/v1/balance',
        init,
      ),
      (error: unknown) => error instanceof PaymentProviderError
        && error.code === 'UNKNOWN' && error.retryable === true,
      coding,
    );
  }
});

test('Stripe rejects malformed content codings before reading and cancels the captured body', async () => {
  const init = { method: 'GET', headers: { Authorization: 'Bearer sk_test_not-a-real-secret' } };
  for (const coding of ['', 'gzip,', 'gzip,,br', 'gzip;level=1', 'x'.repeat(513), Array(17).fill('gzip').join(',')]) {
    let cancellations = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{}')); },
      cancel() { cancellations += 1; },
    });
    await assert.rejects(
      requestStripeApi(
        (async () => new Response(stream, { headers: { 'content-encoding': coding } })) as typeof fetch,
        'https://api.stripe.com/v1/balance',
        init,
      ),
      (error: unknown) => error instanceof PaymentProviderError
        && error.code === 'UNKNOWN' && error.retryable === true,
      coding,
    );
    assert.equal(cancellations, 1, coding);
  }
});

test('Stripe caller abort outranks malformed content coding during response metadata inspection', async () => {
  const controller = new AbortController();
  const upstream = new Response('{}');
  Object.defineProperty(upstream, 'headers', {
    get() {
      controller.abort();
      return new Headers({ 'content-encoding': 'gzip,' });
    },
  });
  await assert.rejects(
    requestStripeApi(
      (async () => upstream) as typeof fetch,
      'https://api.stripe.com/v1/balance',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer sk_test_not-a-real-secret' },
        signal: controller.signal,
      },
    ),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
});
