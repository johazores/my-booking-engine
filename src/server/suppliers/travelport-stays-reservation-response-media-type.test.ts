import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysReservationTraceAuthorityFetch } from './travelport-stays-reservation-trace-fetch.ts';

const traceId = '9f77a0b5-2614-4f6d-9053-f3a6175343f7';

function requestInit(): RequestInit {
  return {
    method: 'POST',
    headers: { E2ETrackingID: `sf-${traceId}` },
    body: '{}',
  };
}

function reservationResponse(contentType: string | null) {
  const headers = new Headers({ traceId });
  if (contentType !== null) headers.set('Content-Type', contentType);
  return new Response(
    new TextEncoder().encode(JSON.stringify({ ReservationResponse: { traceId } })),
    {
      status: 200,
      headers,
    },
  );
}

async function fetchStructuredResponse(contentType: string | null) {
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch(
    (async () => reservationResponse(contentType)) as typeof fetch,
  );
  return wrapped(
    'https://api.pp.travelport.net/11/hotel/book/reservations/build',
    requestInit(),
  );
}

async function assertInvalidContentType(contentType: string | null) {
  await assert.rejects(
    fetchStructuredResponse(contentType),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
}

test('accepts only the documented JSON media type with an optional UTF-8 charset', async () => {
  for (const contentType of [
    'application/json',
    'application/json; charset=utf-8',
    'Application/Json; Charset="UTF-8"',
  ]) {
    const response = await fetchStructuredResponse(contentType);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), contentType);
  }
});

test('rejects missing or contradictory structured reservation media type authority', async () => {
  for (const contentType of [
    null,
    '',
    'text/plain',
    'application/problem+json',
    'application/json; charset=iso-8859-1',
    'application/json; profile=test',
    'application/json; charset=utf-8; charset="utf-8"',
  ]) {
    await assertInvalidContentType(contentType);
  }
});

test('status-only provider failures discard body media type instead of granting structured authority', async () => {
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => new Response(
    '<html>upstream unavailable</html>',
    {
      status: 503,
      headers: {
        'Content-Type': 'text/html',
        'Retry-After': '7',
      },
    },
  )) as typeof fetch);

  const response = await wrapped(
    'https://api.pp.travelport.net/11/hotel/book/reservations/build',
    requestInit(),
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Content-Type'), null);
  assert.equal(response.headers.get('Retry-After'), '7');
  assert.equal(await response.text(), '');
});
