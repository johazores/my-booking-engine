import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STRIPE_WEBHOOK_BODY_READ_TIMEOUT_MS,
  STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES,
  StripeWebhookRequestBodyError,
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

test('test/read overrides may only tighten the production body deadline', async () => {
  assert.equal(STRIPE_WEBHOOK_BODY_READ_TIMEOUT_MS, 10_000);
  await expectBodyError(
    post('{}'),
    'INVALID_BODY',
    { timeoutMs: STRIPE_WEBHOOK_BODY_READ_TIMEOUT_MS + 1 },
  );
});
