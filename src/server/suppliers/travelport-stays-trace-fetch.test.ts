import assert from 'node:assert/strict';
import test from 'node:test';

import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';

const TRACE_ID = '123e4567-e89b-42d3-a456-426614174000';

function captureFetch() {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test('maps SF correlation to the documented v11 TraceId header', async () => {
  const captured = captureFetch();
  const tracedFetch = createTravelportStaysTraceFetch(captured.fetchImpl);
  await tracedFetch('https://api.pp.travelport.net/11/hotel/rules/offershospitality/buildfromrequest', {
    method: 'POST',
    headers: { E2ETrackingID: `sf-${TRACE_ID}`, 'TVP-Trace-Id': 'stale-value' },
  });

  assert.equal(captured.calls.length, 1);
  const headers = new Headers(captured.calls[0]!.init?.headers);
  assert.equal(headers.get('E2ETrackingID'), `sf-${TRACE_ID}`);
  assert.equal(headers.get('TraceId'), TRACE_ID);
  assert.equal(headers.get('TVP-Trace-Id'), null);
});

test('maps SF correlation to the documented v12 TVP-Trace-Id header', async () => {
  const captured = captureFetch();
  const tracedFetch = createTravelportStaysTraceFetch(captured.fetchImpl);
  await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    headers: { E2ETrackingID: `sf-${TRACE_ID}`, TraceId: 'stale-value' },
  });

  assert.equal(captured.calls.length, 1);
  const headers = new Headers(captured.calls[0]!.init?.headers);
  assert.equal(headers.get('TVP-Trace-Id'), TRACE_ID);
  assert.equal(headers.get('TraceId'), null);
});

test('allows only the fixed OAuth token targets without SF request correlation', async () => {
  const captured = captureFetch();
  const tracedFetch = createTravelportStaysTraceFetch(captured.fetchImpl);
  await tracedFetch('https://auth.travelport.net/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      TraceId: 'stale-value',
      'TVP-Trace-Id': 'stale-value',
    },
  });

  assert.equal(captured.calls.length, 1);
  const headers = new Headers(captured.calls[0]!.init?.headers);
  assert.equal(headers.get('TraceId'), null);
  assert.equal(headers.get('TVP-Trace-Id'), null);
});

test('fails closed before transport for missing, foreign, or malformed SF correlation', async () => {
  const captured = captureFetch();
  const tracedFetch = createTravelportStaysTraceFetch(captured.fetchImpl);

  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete'),
    /correlation ID is required/i,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      headers: { E2ETrackingID: TRACE_ID },
    }),
    /correlation ID is required/i,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      headers: { E2ETrackingID: 'sf-not-a-uuid' },
    }),
    /correlation ID is invalid/i,
  );
  assert.equal(captured.calls.length, 0);
});

test('fails closed before transport for unexpected hosts, ports, userinfo, OAuth shapes, or Stays paths', async () => {
  const captured = captureFetch();
  const tracedFetch = createTravelportStaysTraceFetch(captured.fetchImpl);
  const sfHeaders = { E2ETrackingID: `sf-${TRACE_ID}` };

  await assert.rejects(
    tracedFetch('https://example.com/12/hotel/search/searchcomplete', { headers: sfHeaders }),
    /request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net:444/12/hotel/search/searchcomplete', { headers: sfHeaders }),
    /request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://user:pass@api.travelport.net/12/hotel/search/searchcomplete', { headers: sfHeaders }),
    /request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token?next=1'),
    /OAuth request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', { headers: sfHeaders }),
    /OAuth request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net/13/hotel/search/searchcomplete', { headers: sfHeaders }),
    /API version is unsupported/i,
  );
  assert.equal(captured.calls.length, 0);
});
