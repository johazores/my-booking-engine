import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';

const TRACE_ID = '123e4567-e89b-42d3-a456-426614174000';
const STAYS_RESPONSE_LIMIT_BYTES = 32 * 1024 * 1024;

function staysHeaders() {
  return { E2ETrackingID: `sf-${TRACE_ID}` };
}

function assertInvalidResponse(error: unknown) {
  assert.ok(error instanceof HospitalitySupplierProviderError);
  assert.equal(error.code, 'INVALID_RESPONSE');
  assert.equal(error.retryable, false);
  return true;
}

test('rejects oversized declared OAuth and Stays response bodies before adapter parsing', async () => {
  const responses = [
    new Response('{}', { status: 200, headers: { 'Content-Length': String(256 * 1024 + 1) } }),
    new Response('{}', { status: 200, headers: { 'Content-Length': String(STAYS_RESPONSE_LIMIT_BYTES + 1) } }),
  ];
  const tracedFetch = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => responses.shift()!) as typeof fetch,
  });

  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', { method: 'POST' }),
    assertInvalidResponse,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST',
      headers: staysHeaders(),
    }),
    assertInvalidResponse,
  );
});

test('rejects malformed declared response lengths as invalid provider evidence and cancels the body', async () => {
  let cancelled = false;
  const tracedFetch = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([123, 125]));
      },
      cancel() {
        cancelled = true;
      },
    }), {
      status: 200,
      headers: { 'Content-Length': 'not-a-number' },
    })) as typeof fetch,
  });

  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST',
      headers: staysHeaders(),
    }),
    assertInvalidResponse,
  );
  assert.equal(cancelled, true);
});

test('rejects chunked Stays responses when received bytes exceed the transport ceiling', async () => {
  let cancelled = false;
  const fetchImpl = (async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(STAYS_RESPONSE_LIMIT_BYTES));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  }), { status: 200 })) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });

  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST',
      headers: staysHeaders(),
    }),
    assertInvalidResponse,
  );
  assert.equal(cancelled, true);
});

test('coalesces tiny provider chunks into bounded replay blocks', async () => {
  const tinyChunkCount = 10_000;
  const fetchImpl = (async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < tinyChunkCount; index += 1) {
        controller.enqueue(new Uint8Array([index % 251]));
      }
      controller.close();
    },
  }), { status: 200 })) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });
  const response = await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    headers: staysHeaders(),
  });

  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.byteLength, tinyChunkCount);
});

test('preserves bytes exactly when provider chunks cross replay block boundaries', async () => {
  const payload = new Uint8Array(64 * 1024 * 2 + 3);
  for (let index = 0; index < payload.byteLength; index += 1) payload[index] = index % 251;
  const fetchImpl = (async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload.subarray(0, 17));
      controller.enqueue(payload.subarray(17, 64 * 1024 + 11));
      controller.enqueue(payload.subarray(64 * 1024 + 11));
      controller.close();
    },
  }), { status: 200 })) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });
  const response = await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    headers: staysHeaders(),
  });

  const replayed = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(replayed, payload);
});

test('copies narrow source views so oversized backing buffers are not retained by replay', async () => {
  const backing = new Uint8Array(8 * 1024 * 1024);
  backing.set([123, 125], 4 * 1024 * 1024);
  const view = new Uint8Array(backing.buffer, 4 * 1024 * 1024, 2);
  const fetchImpl = (async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(view);
      controller.close();
    },
  }), { status: 200 })) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });
  const response = await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    headers: staysHeaders(),
  });

  const first = await response.body!.getReader().read();
  assert.equal(first.done, false);
  assert.equal(first.value?.byteLength, 2);
  assert.ok((first.value?.buffer.byteLength ?? Infinity) < backing.buffer.byteLength);
  assert.deepEqual([...first.value!], [123, 125]);
});

test('drops stale wire representation headers after replaying decoded bytes', async () => {
  const fetchImpl = (async () => new Response('{"ok":true}', {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Content-Length': '11',
      'X-Provider-Test': 'present',
    },
  })) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });
  const response = await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    headers: staysHeaders(),
  });

  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.equal(response.headers.get('Content-Length'), null);
  assert.equal(response.headers.get('Content-Type'), 'application/json');
  assert.equal(response.headers.get('X-Provider-Test'), 'present');
  assert.deepEqual(await response.json(), { ok: true });
});
