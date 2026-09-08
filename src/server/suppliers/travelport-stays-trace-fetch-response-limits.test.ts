import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';

const TRACE_ID = '123e4567-e89b-42d3-a456-426614174000';
const STAYS_RESPONSE_LIMIT_BYTES = 32 * 1024 * 1024;

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
      headers: { E2ETrackingID: `sf-${TRACE_ID}` },
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
      headers: { E2ETrackingID: `sf-${TRACE_ID}` },
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
      headers: { E2ETrackingID: `sf-${TRACE_ID}` },
    }),
    assertInvalidResponse,
  );
  assert.equal(cancelled, true);
});
