import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';

const TRACE_ID = '123e4567-e89b-42d3-a456-426614174000';
const STAYS_RESPONSE_LIMIT_BYTES = 32 * 1024 * 1024;

function staysHeaders() {
  return { E2ETrackingID: `sf-${TRACE_ID}`, 'Content-Type': 'application/json' };
}

function staysPostInit(): RequestInit {
  return { method: 'POST', headers: staysHeaders(), body: '{}' };
}

function oauthPostInit(): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password', username: 'user', password: 'password', client_id: 'client', client_secret: 'secret',
    }),
  };
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
    tracedFetch('https://auth.travelport.net/oauth/token', oauthPostInit()),
    assertInvalidResponse,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
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
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
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
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
    assertInvalidResponse,
  );
  assert.equal(cancelled, true);
});

test('rejects non-byte provider response chunks as invalid evidence and cancels the upstream stream', async () => {
  const malformedChunks: unknown[] = [
    '{"ok":true}',
    undefined,
    new DataView(new ArrayBuffer(2)),
    new Uint16Array([123]),
  ];
  for (const chunk of malformedChunks) {
    let cancelled = false;
    const fetchImpl = (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk as Uint8Array);
      },
      cancel() {
        cancelled = true;
      },
    }), { status: 200 })) as typeof fetch;
    const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });

    await assert.rejects(
      tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
      assertInvalidResponse,
    );
    assert.equal(cancelled, true);
  }
});

test('preserves the original provider stream read failure while cancelling and releasing its reader', async () => {
  const failure = new Error('provider response stream failed');
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
  const tracedFetch = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => response) as typeof fetch,
  });

  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
    (error: unknown) => error === failure,
  );
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
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
  const response = await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit());

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
  const response = await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit());

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
  const response = await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit());

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
  const response = await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit());

  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.equal(response.headers.get('Content-Length'), null);
  assert.equal(response.headers.get('Content-Type'), 'application/json');
  assert.equal(response.headers.get('X-Provider-Test'), 'present');
  assert.deepEqual(await response.json(), { ok: true });
});


test('rejects endless zero-byte provider chunks and cancels the stream', async () => {
  let cancelled = false;
  const fetchImpl = (async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(0)); },
    cancel() { cancelled = true; },
  }))) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });
  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
    assertInvalidResponse,
  );
  assert.equal(cancelled, true);
});

test('rejects excessive tiny provider chunks below the byte ceiling', async () => {
  let cancelled = false;
  const fetchImpl = (async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array([123])); },
    cancel() { cancelled = true; },
  }))) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });
  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
    assertInvalidResponse,
  );
  assert.equal(cancelled, true);
});

test('Travelport replay uses native typed-array byte lengths and copying despite shadowed accessors', async () => {
  const bytes = new TextEncoder().encode('{"ok":true}');
  Object.defineProperty(bytes, 'byteLength', { get() { return 0; } });
  Object.defineProperty(bytes, 'subarray', { value() { throw new Error('shadowed provider subarray'); } });
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  });
  const tracedFetch = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => new Response(body)) as typeof fetch,
  });
  const response = await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit());
  assert.equal(await response.text(), '{"ok":true}');
});

test('Travelport OAuth response ceiling uses native bytes even when chunk size is shadowed', async () => {
  let cancelled = false;
  const bytes = new Uint8Array(256 * 1024 + 1);
  Object.defineProperty(bytes, 'byteLength', { value: 0 });
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); },
    cancel() { cancelled = true; },
  });
  const tracedFetch = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => new Response(body)) as typeof fetch,
  });
  await assert.rejects(tracedFetch('https://auth.travelport.net/oauth/token', oauthPostInit()), assertInvalidResponse);
  assert.equal(cancelled, true);
});

test('Travelport rejects malformed provider read-result accessors before replay', async () => {
  for (const result of [
    undefined,
    { done: false },
    { get done() { throw new Error('private provider done getter'); } },
    { done: false, get value() { throw new Error('private provider value getter'); } },
  ]) {
    let cancellations = 0;
    const reader = {
      read() { return Promise.resolve(result); },
      cancel() { cancellations += 1; return Promise.resolve(); },
      releaseLock() {},
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;
    const upstream = new Response('{}');
    Object.defineProperty(upstream, 'body', { value: { getReader: () => reader } });
    const tracedFetch = createTravelportStaysTraceFetch({
      environment: 'production',
      fetchImpl: (async () => upstream) as typeof fetch,
    });
    await assert.rejects(
      tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
      (error: unknown) => error instanceof HospitalitySupplierProviderError
        && error.code === 'INVALID_RESPONSE'
        && !error.message.includes('private provider'),
    );
    assert.equal(cancellations, 1);
  }
});

test('Travelport reads one-shot provider result properties once and ignores completed values', async () => {
  const bytes = new TextEncoder().encode('{}');
  let doneReads = 0;
  let valueReads = 0;
  let readCount = 0;
  const reader = {
    read() {
      readCount += 1;
      if (readCount > 1) return Promise.resolve({
        done: true,
        get value() { throw new Error('completed result value must not be read'); },
      });
      return Promise.resolve({
        get done() {
          doneReads += 1;
          if (doneReads > 1) throw new Error('done getter read twice');
          return false;
        },
        get value() {
          valueReads += 1;
          if (valueReads > 1) throw new Error('value getter read twice');
          return bytes;
        },
      });
    },
    cancel() { throw new Error('unexpected cancellation'); },
    releaseLock() {},
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
  const upstream = new Response('{}');
  Object.defineProperty(upstream, 'body', { value: { getReader: () => reader } });
  const tracedFetch = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => upstream) as typeof fetch,
  });
  const response = await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit());
  assert.equal(await response.text(), '{}');
  assert.equal(doneReads, 1);
  assert.equal(valueReads, 1);
  assert.equal(readCount, 2);
});
