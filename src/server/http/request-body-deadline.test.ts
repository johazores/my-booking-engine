import assert from 'node:assert/strict';
import test from 'node:test';

import { cancelRequestBodyReader, discardUnreadRequestBody, readRequestBodyChunkBeforeDeadline, resolveRequestBodyTimeoutMs } from './request-body-deadline.ts';

test('shared request-body deadline cannot be extended', () => {
  assert.equal(resolveRequestBodyTimeoutMs(), 10_000);
  assert.equal(resolveRequestBodyTimeoutMs(20), 20);
  for (const invalid of [0, -1, 10_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(resolveRequestBodyTimeoutMs(invalid), null);
  }
});

test('shared request-body reader accepts complete normal streams', async () => {
  const reader = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.close();
    },
  }).getReader();
  const signal = new AbortController().signal;
  assert.deepEqual((await readRequestBodyChunkBeforeDeadline(reader, signal, signal))?.value, new Uint8Array([1, 2]));
  assert.equal((await readRequestBodyChunkBeforeDeadline(reader, signal, signal))?.done, true);
  reader.releaseLock();
});

test('shared request-body reader returns promptly on timeout even when cancellation stalls', async () => {
  let cancelled = false;
  const reader = new ReadableStream<Uint8Array>({
    pull() { return new Promise<void>(() => undefined); },
    cancel() { cancelled = true; return new Promise<void>(() => undefined); },
  }).getReader();
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 20);
  try {
    assert.equal(await readRequestBodyChunkBeforeDeadline(reader, new AbortController().signal, deadline.signal), null);
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(timeout);
    try { reader.releaseLock(); } catch { /* Pending read may retain lock. */ }
  }
});

test('shared request-body reader returns promptly on client abort', async () => {
  const reader = new ReadableStream<Uint8Array>({
    pull() { return new Promise<void>(() => undefined); },
    cancel() { return new Promise<void>(() => undefined); },
  }).getReader();
  const controller = new AbortController();
  const read = readRequestBodyChunkBeforeDeadline(reader, controller.signal, new AbortController().signal);
  controller.abort();
  assert.equal(await read, null);
  try { reader.releaseLock(); } catch { /* Pending read may retain lock. */ }
});

test('shared request-body reader rejects an already-aborted signal before reading', async () => {
  const reader = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([1])); },
  }).getReader();
  const controller = new AbortController();
  controller.abort();
  assert.equal(await readRequestBodyChunkBeforeDeadline(reader, controller.signal, new AbortController().signal), null);
  reader.releaseLock();
});

test('shared request-body reader fails closed on stream errors', async () => {
  const reader = new ReadableStream<Uint8Array>({
    start(controller) { controller.error(new Error('private stream failure')); },
  }).getReader();
  const signal = new AbortController().signal;
  assert.equal(await readRequestBodyChunkBeforeDeadline(reader, signal, signal), null);
  reader.releaseLock();
});


test('reader cancellation does not throw or await failed cancellation', async () => {
  const throwing = { cancel() { throw new Error('reader closed'); } } as unknown as ReadableStreamDefaultReader<Uint8Array>;
  assert.doesNotThrow(() => cancelRequestBodyReader(throwing));
  const rejecting = { cancel() { return Promise.reject(new Error('cancel rejected')); } } as unknown as ReadableStreamDefaultReader<Uint8Array>;
  assert.doesNotThrow(() => cancelRequestBodyReader(rejecting));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('discarding unread request bodies is nonblocking even when cancellation never settles', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull() { return new Promise<void>(() => undefined); },
    cancel() { cancelled = true; return new Promise<void>(() => undefined); },
  });
  const request = new Request('https://sf.example.test/rejected', {
    method: 'POST', body: stream, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  discardUnreadRequestBody(request);
  assert.equal(cancelled, true);
});

test('discarding an already locked or consumed request does not steal another reader', async () => {
  const locked = new Request('https://sf.example.test/rejected', { method: 'POST', body: 'locked' });
  const reader = locked.body!.getReader();
  discardUnreadRequestBody(locked);
  assert.equal(locked.body!.locked, true);
  reader.releaseLock();

  const consumed = new Request('https://sf.example.test/rejected', { method: 'POST', body: 'used' });
  await consumed.text();
  discardUnreadRequestBody(consumed);
  assert.equal(consumed.bodyUsed, true);
});
