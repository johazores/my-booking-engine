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
  const preProductionFetch = createTravelportStaysTraceFetch({ environment: 'pre-production', fetchImpl: captured.fetchImpl });
  await preProductionFetch('https://api.pp.travelport.net/11/hotel/rules/offershospitality/buildfromrequest', {
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
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl: captured.fetchImpl });
  await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    headers: { E2ETrackingID: `sf-${TRACE_ID}`, TraceId: 'stale-value' },
  });

  assert.equal(captured.calls.length, 1);
  const headers = new Headers(captured.calls[0]!.init?.headers);
  assert.equal(headers.get('TVP-Trace-Id'), TRACE_ID);
  assert.equal(headers.get('TraceId'), null);
});

test('allows every currently implemented Travelport Stays endpoint shape', async () => {
  const captured = captureFetch();
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl: captured.fetchImpl });
  const headers = { E2ETrackingID: `sf-${TRACE_ID}` };
  const requests = [
    ['https://api.travelport.net/12/hotel/search/searchcomplete', 'POST'],
    ['https://api.travelport.net/12/hotel/search/searchcomplete/opaque%2Ftoken%2Bvalue?pageNumber=2', 'GET'],
    ['https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest', 'POST'],
    ['https://api.travelport.net/11/hotel/availability/catalogofferingshospitality', 'POST'],
    ['https://api.travelport.net/11/hotel/availability/catalogofferingshospitality/availability-token?pageNumber=5', 'GET'],
    ['https://api.travelport.net/11/hotel/book/reservations/build', 'POST'],
    ['https://api.travelport.net/11/hotel/book/reservations/build?acceptPriceChangeInd=true&acceptGuaranteeChangeInd=true', 'POST'],
    ['https://api.travelport.net/11/hotel/book/reservations/', 'POST'],
    ['https://api.travelport.net/11/hotel/book/reservations/D6VBHL', 'GET'],
  ] as const;

  for (const [url, method] of requests) await tracedFetch(url, { method, headers });
  assert.equal(captured.calls.length, requests.length);
});

test('allows only the fixed OAuth token targets without SF request correlation', async () => {
  const captured = captureFetch();
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl: captured.fetchImpl });
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
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl: captured.fetchImpl });

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

test('fails closed before transport for cross-environment hosts, unexpected ports, userinfo, OAuth shapes, or API versions', async () => {
  const captured = captureFetch();
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl: captured.fetchImpl });
  const sfHeaders = { E2ETrackingID: `sf-${TRACE_ID}` };

  await assert.rejects(
    tracedFetch('https://api.pp.travelport.net/12/hotel/search/searchcomplete', { method: 'POST', headers: sfHeaders }),
    /request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://example.com/12/hotel/search/searchcomplete', { method: 'POST', headers: sfHeaders }),
    /request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net:444/12/hotel/search/searchcomplete', { method: 'POST', headers: sfHeaders }),
    /request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://user:pass@api.travelport.net/12/hotel/search/searchcomplete', { method: 'POST', headers: sfHeaders }),
    /request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://auth.pp.travelport.net/oauth/token', { method: 'POST' }),
    /request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', { method: 'GET' }),
    /OAuth request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token?next=1', { method: 'POST' }),
    /OAuth request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', { method: 'POST', headers: sfHeaders }),
    /OAuth request target is invalid/i,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net/13/hotel/search/searchcomplete', { method: 'POST', headers: sfHeaders }),
    /Stays request target is invalid/i,
  );
  assert.equal(captured.calls.length, 0);
});

test('fails closed for unsupported Stays methods, paths, and query parameters', async () => {
  const captured = captureFetch();
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl: captured.fetchImpl });
  const headers = { E2ETrackingID: `sf-${TRACE_ID}` };
  const rejected = [
    ['https://api.travelport.net/12/hotel/search/searchcomplete', 'DELETE'],
    ['https://api.travelport.net/12/hotel/search/searchcomplete?pageNumber=2', 'POST'],
    ['https://api.travelport.net/12/hotel/search/searchcomplete/token?pageNumber=1', 'GET'],
    ['https://api.travelport.net/12/hotel/search/searchcomplete/token?pageNumber=2&extra=true', 'GET'],
    ['https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest?extra=true', 'POST'],
    ['https://api.travelport.net/11/hotel/availability/catalogofferingshospitality/token?pageNumber=6', 'GET'],
    ['https://api.travelport.net/11/hotel/book/reservations/build?acceptPriceChangeInd=false', 'POST'],
    ['https://api.travelport.net/11/hotel/book/reservations/build?acceptPriceChangeInd=true&acceptPriceChangeInd=true', 'POST'],
    ['https://api.travelport.net/11/hotel/book/reservations/build', 'GET'],
    ['https://api.travelport.net/11/hotel/book/reservations/', 'GET'],
    ['https://api.travelport.net/11/hotel/unsupported', 'POST'],
  ] as const;

  for (const [url, method] of rejected) {
    await assert.rejects(tracedFetch(url, { method, headers }), /Stays request target is invalid/i);
  }
  assert.equal(captured.calls.length, 0);
});

test('fails closed when the transport environment is invalid', () => {
  const captured = captureFetch();
  assert.throws(
    () => createTravelportStaysTraceFetch({ environment: 'qa' as never, fetchImpl: captured.fetchImpl }),
    /transport environment is invalid/i,
  );
  assert.equal(captured.calls.length, 0);
});
