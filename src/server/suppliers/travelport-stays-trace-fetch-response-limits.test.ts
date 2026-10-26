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


function assertTravelportAborted(error: unknown) {
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'AbortError');
  return true;
}

test('OAuth and Stays abort stalled injected Fetch without accepting late responses', { timeout: 2_000 }, async () => {
  for (const oauth of [true, false]) {
    const controller = new AbortController();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let resolveFetch!: (response: Response) => void;
    const fetchImpl = (async () => {
      started();
      return new Promise<Response>((resolve) => { resolveFetch = resolve; });
    }) as typeof fetch;
    const traced = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });
    const pending = traced(
      oauth ? 'https://auth.travelport.net/oauth/token' : 'https://api.travelport.net/12/hotel/search/searchcomplete',
      { ...(oauth ? oauthPostInit() : staysPostInit()), signal: controller.signal },
    );
    await startedPromise;
    controller.abort();
    await assert.rejects(pending, assertTravelportAborted);

    let cancelled = 0;
    resolveFetch(new Response(new ReadableStream<Uint8Array>({
      cancel() { cancelled += 1; },
    })));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(cancelled, 1, 'late response body must be cancelled without blocking abort');
  }
});

test('OAuth and Stays abort stalled provider body reads and release readers', { timeout: 2_000 }, async () => {
  for (const oauth of [true, false]) {
    const controller = new AbortController();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let cancelled = 0;
    let released = 0;
    const response = new Response('{}');
    Object.defineProperty(response, 'body', {
      value: {
        getReader() {
          return {
            read() { started(); return new Promise(() => undefined); },
            cancel() { cancelled += 1; return Promise.resolve(); },
            releaseLock() { released += 1; },
          };
        },
      },
    });
    const traced = createTravelportStaysTraceFetch({
      environment: 'production',
      fetchImpl: (async () => response) as typeof fetch,
    });
    const pending = traced(
      oauth ? 'https://auth.travelport.net/oauth/token' : 'https://api.travelport.net/12/hotel/search/searchcomplete',
      { ...(oauth ? oauthPostInit() : staysPostInit()), signal: controller.signal },
    );
    await startedPromise;
    controller.abort();
    await assert.rejects(pending, assertTravelportAborted);
    assert.equal(cancelled, 1);
    assert.equal(released, 1);
  }
});

test('abort wins over completed stream result and a failing reader release', async () => {
  const controller = new AbortController();
  let cancelled = 0;
  const response = new Response('{}');
  Object.defineProperty(response, 'body', {
    value: {
      getReader() {
        return {
          read() {
            controller.abort();
            return Promise.resolve({ done: true, value: undefined });
          },
          cancel() { cancelled += 1; return Promise.resolve(); },
          releaseLock() { throw new Error('private reader release failure'); },
        };
      },
    },
  });
  const traced = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => response) as typeof fetch,
  });
  await assert.rejects(
    traced('https://api.travelport.net/12/hotel/search/searchcomplete', {
      ...staysPostInit(), signal: controller.signal,
    }),
    assertTravelportAborted,
  );
  assert.equal(cancelled, 1);
});

test('noncanonical and excessive declared Travelport response lengths are rejected and cancelled', async () => {
  for (const contentLength of ['0002', '999999999999999999999999999']) {
    let cancelled = 0;
    const traced = createTravelportStaysTraceFetch({
      environment: 'production',
      fetchImpl: (async () => new Response(new ReadableStream<Uint8Array>({
        cancel() { cancelled += 1; },
      }), { headers: { 'Content-Length': contentLength } })) as typeof fetch,
    });
    await assert.rejects(
      traced('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
      assertInvalidResponse,
    );
    assert.equal(cancelled, 1);
  }
});

test('locked Travelport provider body cannot bypass reader acquisition failure classification', async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([123, 125])); } });
  const response = new Response(stream);
  const heldReader = stream.getReader();
  try {
    const traced = createTravelportStaysTraceFetch({
      environment: 'production',
      fetchImpl: (async () => response) as typeof fetch,
    });
    await assert.rejects(
      traced('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
      assertInvalidResponse,
    );
  } finally {
    heldReader.releaseLock();
    await stream.cancel().catch(() => undefined);
  }
});

test('a provider reader that cannot release after success is rejected as invalid evidence', async () => {
  const response = new Response('{}');
  Object.defineProperty(response, 'body', {
    value: {
      getReader() {
        return {
          read() { return Promise.resolve({ done: true, value: undefined }); },
          cancel() { return Promise.resolve(); },
          releaseLock() { throw new Error('private release failure'); },
        };
      },
    },
  });
  const traced = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => response) as typeof fetch,
  });
  await assert.rejects(
    traced('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
    assertInvalidResponse,
  );
});

test('Travelport snapshots response body, headers and status metadata once before replay', async () => {
  const upstream = new Response('{}', {
    headers: { 'Content-Type': 'application/json', 'Content-Length': '2' },
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
        if (count > 1) throw new Error('response metadata read more than once');
        return value;
      },
    });
  }
  const traced = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => upstream) as typeof fetch,
  });
  const response = await traced('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit());
  assert.equal(await response.text(), '{}');
  assert.equal(response.headers.get('Content-Type'), 'application/json');
  assert.equal(response.headers.get('Content-Length'), null);
  for (const key of Object.keys(snapshot)) assert.equal(reads.get(key), 1, key);
});

test('Travelport replays the validated header snapshot when upstream headers mutate during reading', async () => {
  const upstream = new Response('{}', {
    headers: { 'Content-Type': 'application/json', 'Content-Length': '2' },
  });
  const mutableHeaders = upstream.headers;
  Object.defineProperty(upstream, 'body', {
    value: {
      getReader() {
        let reads = 0;
        return {
          read() {
            reads += 1;
            if (reads === 1) {
              mutableHeaders.set('Content-Type', 'text/plain');
              mutableHeaders.set('Content-Length', '99999999');
              return Promise.resolve({ done: false, value: new TextEncoder().encode('{}') });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
          cancel() { return Promise.resolve(); },
          releaseLock() {},
        };
      },
    },
  });
  const traced = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => upstream) as typeof fetch,
  });
  const response = await traced('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit());
  assert.equal(await response.text(), '{}');
  assert.equal(response.headers.get('Content-Type'), 'application/json');
  assert.equal(response.headers.get('Content-Length'), null);
});

test('Travelport rejects throwing response metadata and cancels available bodies', async () => {
  for (const field of ['body', 'headers', 'status', 'statusText'] as const) {
    let cancelled = 0;
    const upstream = new Response(new ReadableStream<Uint8Array>({
      cancel() { cancelled += 1; },
    }));
    Object.defineProperty(upstream, field, {
      get() { throw new Error('private response metadata failure'); },
    });
    const traced = createTravelportStaysTraceFetch({
      environment: 'production',
      fetchImpl: (async () => upstream) as typeof fetch,
    });
    await assert.rejects(
      traced('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
      assertInvalidResponse,
    );
    assert.equal(cancelled, field === 'body' ? 0 : 1, field);
  }
});

test('Travelport preserves caller abort when reader release itself aborts and fails', async () => {
  const controller = new AbortController();
  let cancelled = 0;
  const upstream = new Response('{}');
  Object.defineProperty(upstream, 'body', {
    value: {
      getReader() {
        return {
          read() { return Promise.resolve({ done: true, value: undefined }); },
          cancel() { cancelled += 1; return Promise.resolve(); },
          releaseLock() { controller.abort(); throw new Error('private release failure'); },
        };
      },
    },
  });
  const traced = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => upstream) as typeof fetch,
  });
  await assert.rejects(
    traced('https://api.travelport.net/12/hotel/search/searchcomplete', {
      ...staysPostInit(), signal: controller.signal,
    }),
    assertTravelportAborted,
  );
  assert.equal(cancelled, 1);
});

test('Travelport normalizes response replay construction failures', async () => {
  const upstream = new Response('{}');
  Object.defineProperty(upstream, 'status', { value: 0 });
  const traced = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => upstream) as typeof fetch,
  });
  await assert.rejects(
    traced('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
    assertInvalidResponse,
  );
});

test('Travelport snapshots and sanitizes bodyless OAuth and Stays responses', async () => {
  for (const oauth of [true, false]) {
    const upstream = new Response(null, {
      status: 204,
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': '0',
        'X-Provider-Test': 'original',
      },
    });
    const snapshot = {
      body: upstream.body,
      headers: upstream.headers,
      status: upstream.status,
      statusText: upstream.statusText,
    };
    const reads = new Map<string, number>();
    for (const [field, value] of Object.entries(snapshot)) {
      Object.defineProperty(upstream, field, {
        configurable: true,
        get() {
          const count = (reads.get(field) ?? 0) + 1;
          reads.set(field, count);
          if (count > 1) throw new Error('bodyless provider metadata read twice');
          if (field === 'statusText') snapshot.headers.set('X-Provider-Test', 'mutated');
          return value;
        },
      });
    }
    const traced = createTravelportStaysTraceFetch({
      environment: 'production',
      fetchImpl: (async () => upstream) as typeof fetch,
    });
    const response = await traced(
      oauth ? 'https://auth.travelport.net/oauth/token' : 'https://api.travelport.net/12/hotel/search/searchcomplete',
      oauth ? oauthPostInit() : staysPostInit(),
    );
    assert.notEqual(response, upstream);
    assert.equal(response.status, 204);
    assert.equal(response.body, null);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('Content-Encoding'), null);
    assert.equal(response.headers.get('Content-Length'), null);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    assert.equal(response.headers.get('X-Provider-Test'), 'original');
    for (const field of Object.keys(snapshot)) assert.equal(reads.get(field), 1, field);
  }
});

test('Travelport rejects bodyless responses declaring missing payload bytes', async () => {
  for (const status of [200, 204, 429]) {
    const traced = createTravelportStaysTraceFetch({
      environment: 'production',
      fetchImpl: (async () => new Response(null, {
        status,
        headers: { 'Content-Length': '2' },
      })) as typeof fetch,
    });
    await assert.rejects(
      traced('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
      assertInvalidResponse,
    );
  }
});

test('Travelport preserves valid HTTP 304 representation length without inventing a body', async () => {
  const traced = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => new Response(null, {
      status: 304,
      headers: { 'Content-Length': '12', 'Content-Encoding': 'gzip', 'X-Provider-Test': 'present' },
    })) as typeof fetch,
  });
  const response = await traced('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit());
  assert.equal(response.status, 304);
  assert.equal(response.body, null);
  assert.equal(response.headers.get('Content-Length'), null);
  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.equal(response.headers.get('X-Provider-Test'), 'present');
});

test('Travelport normalizes invalid bodyless response metadata and preserves caller abort', async () => {
  const malformed = new Response(null, { status: 200 });
  Object.defineProperty(malformed, 'status', { value: 0 });
  const invalid = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => malformed) as typeof fetch,
  });
  await assert.rejects(
    invalid('https://api.travelport.net/12/hotel/search/searchcomplete', staysPostInit()),
    assertInvalidResponse,
  );

  const controller = new AbortController();
  const upstream = new Response(null, { status: 204 });
  Object.defineProperty(upstream, 'statusText', {
    get() { controller.abort(); return ''; },
  });
  const traced = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async () => upstream) as typeof fetch,
  });
  await assert.rejects(
    traced('https://api.travelport.net/12/hotel/search/searchcomplete', {
      ...staysPostInit(), signal: controller.signal,
    }),
    assertTravelportAborted,
  );
});
