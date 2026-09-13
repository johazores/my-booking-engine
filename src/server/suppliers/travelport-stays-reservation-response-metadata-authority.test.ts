import assert from 'node:assert/strict';
import test from 'node:test';

import { createTravelportStaysReservationTraceAuthorityFetch } from './travelport-stays-reservation-trace-fetch.ts';

const traceId = '9f77a0b5-2614-4f6d-9053-f3a6175343f7';

function requestInit(): RequestInit {
  return {
    method: 'POST',
    headers: { E2ETrackingID: `sf-${traceId}` },
    body: '{}',
  };
}

function structuredResponse() {
  return new Response(JSON.stringify({
    ReservationResponse: {
      traceId,
      marker: 'preserved',
    },
  }), {
    status: 200,
    statusText: 'provider supplied detail',
    headers: {
      'Content-Type': 'Application/Json; Charset="UTF-8"',
      'Content-Language': 'en',
      'Retry-After': '7',
      'X-Provider-Correlation': 'provider-owned-correlation',
      traceId,
    },
  });
}

async function statusOnlyResponse(retryAfter: string) {
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => new Response('{}', {
    status: 429,
    headers: { 'Retry-After': retryAfter },
  })) as typeof fetch);
  return wrapped(
    'https://api.pp.travelport.net/11/hotel/book/reservations/build',
    requestInit(),
  );
}

test('structured reservation replay exposes only validated trace and representation metadata', async () => {
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch(
    (async () => structuredResponse()) as typeof fetch,
  );
  const response = await wrapped(
    'https://api.pp.travelport.net/11/hotel/book/reservations/build',
    requestInit(),
  );

  assert.equal(response.status, 200);
  assert.equal(response.statusText, '');
  assert.deepEqual([...response.headers.entries()], [
    ['content-type', 'Application/Json; Charset="UTF-8"'],
    ['traceid', traceId],
  ]);
  assert.deepEqual(await response.json(), {
    ReservationResponse: {
      traceId,
      marker: 'preserved',
    },
  });
});

test('status-only reservation failures preserve only syntactically valid Retry-After authority', async () => {
  for (const retryAfter of [
    '0',
    '7',
    '0007',
    'Sun, 06 Nov 1994 08:49:37 GMT',
  ]) {
    const response = await statusOnlyResponse(retryAfter);
    assert.equal(response.headers.get('Retry-After'), retryAfter);
  }

  for (const retryAfter of [
    '+7',
    '7.5',
    '1e3',
    'tomorrow',
    'sun, 06 Nov 1994 08:49:37 GMT',
    'Sun, 32 Nov 1994 08:49:37 GMT',
    'Sunday, 06-Nov-94 08:49:37 GMT',
    'x'.repeat(257),
  ]) {
    const response = await statusOnlyResponse(retryAfter);
    assert.equal(response.headers.get('Retry-After'), null, retryAfter);
  }
});
