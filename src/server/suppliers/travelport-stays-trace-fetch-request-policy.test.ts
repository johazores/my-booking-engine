import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';

const TRACE_ID = '123e4567-e89b-42d3-a456-426614174000';

function assertInvalidRequest(error: unknown) {
  assert.ok(error instanceof HospitalitySupplierProviderError);
  assert.equal(error.code, 'INVALID_REQUEST');
  assert.equal(error.retryable, false);
  return true;
}

test('forces no-store cache semantics and omits ambient credentials for OAuth and Stays', async () => {
  const calls: Array<RequestInit | undefined> = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });

  await tracedFetch('https://auth.travelport.net/oauth/token', { method: 'POST', cache: 'force-cache', credentials: 'include' });
  await tracedFetch(new Request('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    cache: 'force-cache',
    credentials: 'include',
    headers: { E2ETrackingID: `sf-${TRACE_ID}` },
  }));

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.cache, 'no-store');
  assert.equal(calls[1]?.cache, 'no-store');
  assert.equal(calls[0]?.credentials, 'omit');
  assert.equal(calls[1]?.credentials, 'omit');
});

test('rejects caller-controlled routing, ambient credential, forwarding, and hop-by-hop headers before Travelport transport', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });
  const forbiddenHeaders = [
    ['Host', 'example.com'],
    ['Cookie', 'session=secret'],
    ['Content-Length', '2'],
    ['Connection', 'keep-alive'],
    ['Proxy-Authorization', 'Basic secret'],
    ['Transfer-Encoding', 'chunked'],
    ['Forwarded', 'for=127.0.0.1'],
    ['X-Forwarded-Host', 'example.com'],
    ['If-None-Match', '"stale-etag"'],
    ['Range', 'bytes=0-99'],
    ['Origin', 'https://sf.example'],
    ['Referer', 'https://sf.example/book'],
  ] as const;

  for (const [name, value] of forbiddenHeaders) {
    await assert.rejects(
      tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
        method: 'POST',
        headers: { E2ETrackingID: `sf-${TRACE_ID}`, [name]: value },
      }),
      assertInvalidRequest,
    );
  }

  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', {
      method: 'POST',
      headers: { Cookie: 'session=secret' },
    }),
    assertInvalidRequest,
  );
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', {
      method: 'POST',
      headers: { Authorization: 'Bearer stays-token' },
    }),
    assertInvalidRequest,
  );

  assert.equal(calls, 0);
});
