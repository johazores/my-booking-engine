import assert from 'node:assert/strict';
import test from 'node:test';

import { readBoundedJsonObject } from './bounded-json-body.ts';

const url = 'https://sf.example.test/api/booking';
function jsonRequest(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
}

test('bounded JSON reader accepts exact declared UTF-8 bytes and optional length', async () => {
  const body = JSON.stringify({ guest: 'Café', amountMinor: 1200 });
  const bytes = new TextEncoder().encode(body).byteLength;
  assert.deepEqual(await readBoundedJsonObject(jsonRequest(body), bytes), { guest: 'Café', amountMinor: 1200 });
  assert.deepEqual(await readBoundedJsonObject(jsonRequest(body, { 'content-length': String(bytes) }), bytes), { guest: 'Café', amountMinor: 1200 });
});

test('bounded JSON reader rejects false length declarations in both directions', async () => {
  const body = '{"ok":true}';
  const length = new TextEncoder().encode(body).byteLength;
  for (const declared of [length - 1, length + 1, 0]) {
    assert.equal(await readBoundedJsonObject(jsonRequest(body, { 'content-length': String(declared) }), 1024), null);
  }
  for (const declared of ['invalid', '-1', '1.5', '1e2', '999999999999999999999']) {
    assert.equal(await readBoundedJsonObject(jsonRequest(body, { 'content-length': declared }), 1024), null);
  }
});

test('bounded JSON reader rejects invalid media types, envelopes and absent bodies', async () => {
  assert.equal(await readBoundedJsonObject(jsonRequest('{}', { 'content-type': 'text/plain' }), 1024), null);
  for (const body of ['null', '[]', '"string"', '{']) {
    assert.equal(await readBoundedJsonObject(jsonRequest(body), 1024), null);
  }
  assert.equal(await readBoundedJsonObject(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }), 1024), null);
  assert.equal(await readBoundedJsonObject(jsonRequest('{}'), 0), null);
});

test('bounded JSON reader enforces streamed byte limit without trusting headers', async () => {
  assert.deepEqual(await readBoundedJsonObject(jsonRequest('{}'), 2), {});
  assert.equal(await readBoundedJsonObject(jsonRequest('{}'), 1), null);
  assert.equal(await readBoundedJsonObject(jsonRequest('{"value":"' + 'x'.repeat(100) + '"}'), 32), null);
  assert.equal(await readBoundedJsonObject(jsonRequest('{}', { 'content-length': '1000' }), 32), null);
});

test('bounded JSON reader rejects malformed UTF-8 including split sequences', async () => {
  assert.equal(await readBoundedJsonObject(jsonRequest(new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d])), 1024), null);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3]));
      controller.enqueue(new Uint8Array([0x28, 0x22, 0x7d]));
      controller.close();
    },
  });
  const request = new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' });
  assert.equal(await readBoundedJsonObject(request, 1024), null);
});

test('bounded JSON reader handles streams failing during reading', async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('internal stream failure')); } });
  const request = new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' });
  assert.equal(await readBoundedJsonObject(request, 1024), null);
});


test('bounded JSON reader rejects already locked request streams', async () => {
  const request = jsonRequest('{"ok":true}');
  const reader = request.body!.getReader();
  try {
    assert.equal(await readBoundedJsonObject(request, 1024), null);
  } finally {
    reader.releaseLock();
  }
});


test('bounded JSON reader rejects consumed but unlocked request streams', async () => {
  const request = jsonRequest('{"ok":true}');
  const reader = request.body!.getReader();
  while (!(await reader.read()).done) { /* Consume the body without retaining the lock. */ }
  reader.releaseLock();
  assert.equal(request.bodyUsed, true);
  assert.equal(await readBoundedJsonObject(request, 1024), null);
});
