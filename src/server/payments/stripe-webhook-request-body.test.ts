import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STRIPE_WEBHOOK_BODY_READ_TIMEOUT_MS,
  STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES,
  StripeWebhookRequestBodyError,
  discardStripeWebhookRequestBody,
  readStripeWebhookRequestBody,
} from './stripe-webhook-request-body.ts';

function post(body: BodyInit, headers?: HeadersInit, signal?: AbortSignal) {
  return new Request('https://sf.example.test/api/webhooks/stripe/tenant', {
    method: 'POST',
    body,
    headers,
    signal,
  });
}

async function settlesPromptly<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Request cancellation stalled.')), 3_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function expectBodyError(
  request: Request,
  code: StripeWebhookRequestBodyError['code'],
  options?: Readonly<{ timeoutMs?: number }>,
) {
  await assert.rejects(
    () => readStripeWebhookRequestBody(request, options),
    (error: unknown) => error instanceof StripeWebhookRequestBodyError && error.code === code,
  );
}

test('reads valid UTF-8 raw payloads through the exact byte ceiling', async () => {
  const prefix = '€';
  const body = `${prefix}${'a'.repeat(STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES - 3)}`;
  assert.equal(Buffer.byteLength(body, 'utf8'), STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES);
  assert.equal(await readStripeWebhookRequestBody(post(body)), body);
});

test('rejects oversized declared Content-Length before body acquisition', async () => {
  await expectBodyError(post('{}', {
    'content-length': String(STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES + 1),
  }), 'PAYLOAD_TOO_LARGE');
});

test('rejects malformed declared Content-Length', async () => {
  await expectBodyError(post('{}', { 'content-length': '12, 12' }), 'INVALID_CONTENT_LENGTH');
});

test('accepts an exact declared Content-Length', async () => {
  assert.equal(await readStripeWebhookRequestBody(post('{}', { 'content-length': '2' })), '{}');
});

test('rejects Content-Length disagreement in either direction', async () => {
  await expectBodyError(post('{}', { 'content-length': '1' }), 'CONTENT_LENGTH_MISMATCH');
  await expectBodyError(post('{}', { 'content-length': '3' }), 'CONTENT_LENGTH_MISMATCH');
});

test('cancels the stream when received bytes exceed declared framing', async () => {
  let cancelCalled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0x7b, 0x7d]));
    },
    cancel() {
      cancelCalled = true;
      return undefined;
    },
  });
  const request = new Request('https://sf.example.test/api/webhooks/stripe/tenant', {
    method: 'POST',
    body: stream,
    headers: { 'content-length': '1' },
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  await expectBodyError(request, 'CONTENT_LENGTH_MISMATCH');
  assert.equal(cancelCalled, true);
});

test('counts actual stream bytes when Content-Length is absent or understated', async () => {
  const oversized = 'a'.repeat(STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES + 1);
  await expectBodyError(post(oversized), 'PAYLOAD_TOO_LARGE');
  await expectBodyError(post(oversized, { 'content-length': '1' }), 'PAYLOAD_TOO_LARGE');
});

test('rejects invalid UTF-8 rather than normalizing bytes before signature verification', async () => {
  await expectBodyError(post(new Uint8Array([0xc3, 0x28])), 'INVALID_ENCODING');
});

test('fails closed when the request is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  await expectBodyError(post('{}', undefined, controller.signal), 'BODY_ABORTED');
});

test('rejects missing and empty webhook bodies before provider verification', async () => {
  const url = 'https://sf.example.test/api/webhooks/stripe/tenant';
  await expectBodyError(new Request(url, { method: 'POST' }), 'INVALID_BODY');
  await expectBodyError(new Request(url, {
    method: 'POST', headers: { 'content-length': '1' },
  }), 'CONTENT_LENGTH_MISMATCH');
  await expectBodyError(post(''), 'INVALID_BODY');
  await expectBodyError(post('', { 'content-length': '0' }), 'INVALID_BODY');
});

test('rejects consumed but unlocked webhook request bodies', async () => {
  const request = post('{"id":"evt_used"}');
  const reader = request.body!.getReader();
  while (!(await reader.read()).done) { /* Consume and release the lock. */ }
  reader.releaseLock();
  assert.equal(request.bodyUsed, true);
  await expectBodyError(request, 'INVALID_BODY');
});

test('rejects locked webhook request bodies', async () => {
  const request = post('{"id":"evt_locked"}');
  const reader = request.body!.getReader();
  try {
    await expectBodyError(request, 'INVALID_BODY');
  } finally {
    reader.releaseLock();
  }
});

test('rejects an aborted webhook stream even with queued body bytes', async () => {
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start(source) {
      source.enqueue(new TextEncoder().encode('{"id":"evt_aborted"}'));
      source.close();
      controller.abort();
    },
  });
  const request = new Request('https://sf.example.test/api/webhooks/stripe/tenant', {
    method: 'POST', body: stream, signal: controller.signal, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  await expectBodyError(request, 'BODY_ABORTED');
});

test('aborts a pending body read without waiting for stream cancellation', async () => {
  const controller = new AbortController();
  let cancelCalled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
    cancel() {
      cancelCalled = true;
      return new Promise<void>(() => undefined);
    },
  });
  const request = new Request('https://sf.example.test/api/webhooks/stripe/tenant', {
    method: 'POST',
    body: stream,
    signal: controller.signal,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  const read = readStripeWebhookRequestBody(request);
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(
    read,
    (error: unknown) => error instanceof StripeWebhookRequestBodyError && error.code === 'BODY_ABORTED',
  );
  assert.equal(cancelCalled, true);
});

test('fails closed when total body acquisition exceeds the SF-owned deadline', async () => {
  let cancelCalled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
    cancel() {
      cancelCalled = true;
      return new Promise<void>(() => undefined);
    },
  });
  const request = new Request('https://sf.example.test/api/webhooks/stripe/tenant', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  await expectBodyError(request, 'BODY_TIMEOUT', { timeoutMs: 20 });
  assert.equal(cancelCalled, true);
});

test('preflight callers can discard an unread webhook stream without awaiting cancellation', async () => {
  let cancelCalled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
    cancel() {
      cancelCalled = true;
      return undefined;
    },
  });
  const request = new Request('https://sf.example.test/api/webhooks/stripe/tenant', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  discardStripeWebhookRequestBody(request);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelCalled, true);
});

test('invalid webhook deadline preflight discards an unread stream without awaiting cancellation', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull() { return new Promise<void>(() => undefined); },
    cancel() { cancelled = true; return new Promise<void>(() => undefined); },
  });
  const request = new Request('https://sf.example.test/api/webhooks/stripe/tenant', {
    method: 'POST', body: stream, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  await settlesPromptly(expectBodyError(request, 'INVALID_BODY', { timeoutMs: STRIPE_WEBHOOK_BODY_READ_TIMEOUT_MS + 1 }));
  assert.equal(cancelled, true);
});

test('webhook preflight discard leaves locked and consumed bodies untouched', async () => {
  const locked = post('{"id":"locked"}');
  const reader = locked.body!.getReader();
  discardStripeWebhookRequestBody(locked);
  assert.equal(locked.body!.locked, true);
  reader.releaseLock();

  const used = post('{"id":"used"}');
  await used.text();
  discardStripeWebhookRequestBody(used);
  assert.equal(used.bodyUsed, true);
});

test('test/read overrides may only tighten the production body deadline', async () => {
  assert.equal(STRIPE_WEBHOOK_BODY_READ_TIMEOUT_MS, 10_000);
  await expectBodyError(
    post('{}'),
    'INVALID_BODY',
    { timeoutMs: STRIPE_WEBHOOK_BODY_READ_TIMEOUT_MS + 1 },
  );
});

test('rejects endless zero-byte webhook chunks without awaiting stalled cancellation', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(0)); },
    cancel() { cancelled = true; return new Promise<void>(() => undefined); },
  });
  const request = new Request('https://sf.example.test/api/webhooks/stripe/tenant', {
    method: 'POST', body: stream, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  await settlesPromptly(expectBodyError(request, 'INVALID_BODY'));
  assert.equal(cancelled, true);
});

test('rejects excessive tiny webhook chunks below its byte ceiling', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array([0x7b])); },
    cancel() { cancelled = true; return Promise.reject(new Error('Cancellation failed.')); },
  });
  const request = new Request('https://sf.example.test/api/webhooks/stripe/tenant', {
    method: 'POST', body: stream, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  await settlesPromptly(expectBodyError(request, 'INVALID_BODY'));
  assert.equal(cancelled, true);
});

test('rejects oversized webhook bodies without awaiting stalled cancellation', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES + 1)); },
    cancel() { cancelled = true; return new Promise<void>(() => undefined); },
  });
  const request = new Request('https://sf.example.test/api/webhooks/stripe/tenant', {
    method: 'POST', body: stream, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  await settlesPromptly(expectBodyError(request, 'PAYLOAD_TOO_LARGE'));
  assert.equal(cancelled, true);
});

test('webhook reader counts native bytes despite shadowed stream chunk length', async () => {
  const bytes = new TextEncoder().encode('{"id":"evt_1"}');
  Object.defineProperty(bytes, 'byteLength', { value: 0 });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  });
  const request = new Request('https://sf.example.test/api/webhooks/stripe/tenant', {
    method: 'POST', body: stream, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  assert.equal(await readStripeWebhookRequestBody(request), '{"id":"evt_1"}');
});

test('webhook reader rejects native over-limit bytes hidden by a shadowed length', async () => {
  const bytes = new Uint8Array(STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES + 1);
  Object.defineProperty(bytes, 'byteLength', { value: 0 });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  });
  const request = new Request('https://sf.example.test/api/webhooks/stripe/tenant', {
    method: 'POST', body: stream, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  await expectBodyError(request, 'PAYLOAD_TOO_LARGE');
});

test('webhook ingress rejects ambiguous framing before accepting signature evidence', async () => {
  for (const headers of [
    { 'content-length': '02' },
    { 'content-length': '000000000000000000000' },
    { 'content-length': '2', 'transfer-encoding': 'chunked' },
  ]) {
    await expectBodyError(post('{}', headers), 'INVALID_CONTENT_LENGTH');
  }
  assert.equal(await readStripeWebhookRequestBody(post('{}', { 'transfer-encoding': 'chunked' })), '{}');
});
