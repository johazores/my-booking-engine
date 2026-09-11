import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysReservationTraceAuthorityFetch } from './travelport-stays-reservation-trace-fetch.ts';

const traceId = '9f77a0b5-2614-4f6d-9053-f3a6175343f7';

function requestInit(method: string): RequestInit {
  return {
    method,
    headers: { E2ETrackingID: `sf-${traceId}` },
    ...(method === 'POST' ? { body: '{}' } : {}),
  };
}

function reservationResponse() {
  return new Response(JSON.stringify({ ReservationResponse: { traceId } }), {
    status: 200,
    headers: { traceId, 'Content-Type': 'application/json' },
  });
}

function invalidRequest(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST';
}

test('reservation authority rejects unsupported namespace shapes before provider I/O', async () => {
  let providerCalls = 0;
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => {
    providerCalls += 1;
    return reservationResponse();
  }) as typeof fetch);

  const unsupported: ReadonlyArray<readonly [string, RequestInit]> = [
    ['https://api.pp.travelport.net/11/hotel/book/reservations', requestInit('POST')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/passive', requestInit('POST')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/build', requestInit('GET')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/D6VBHL', requestInit('POST')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/', requestInit('GET')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/build', requestInit('PUT')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/build?acceptPriceChangeInd=false', requestInit('POST')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/build?acceptPriceChangeInd=true&acceptPriceChangeInd=true', requestInit('POST')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/build?unreviewed=true', requestInit('POST')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/D6VBHL?detail=true', requestInit('GET')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/D6VBHL/history', requestInit('GET')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/%44%36VBHL', requestInit('GET')],
  ];

  for (const [url, init] of unsupported) {
    await assert.rejects(wrapped(url, init), invalidRequest, `${init.method} ${url}`);
  }
  assert.equal(providerCalls, 0);
});

test('reservation authority accepts only the implemented Create, Sync, and Retrieve route shapes', async () => {
  const providerCalls: string[] = [];
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async (input, init) => {
    providerCalls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    return reservationResponse();
  }) as typeof fetch);

  const supported: ReadonlyArray<readonly [string, RequestInit]> = [
    ['https://api.pp.travelport.net/11/hotel/book/reservations/build', requestInit('POST')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/build?acceptPriceChangeInd=true', requestInit('POST')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/build?acceptGuaranteeChangeInd=true&acceptPriceChangeInd=true', requestInit('POST')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/', requestInit('POST')],
    ['https://api.pp.travelport.net/11/hotel/book/reservations/D6VBHL', requestInit('GET')],
  ];

  for (const [url, init] of supported) {
    const response = await wrapped(url, init);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { ReservationResponse?: { traceId?: string } }).ReservationResponse?.traceId, traceId);
  }
  assert.equal(providerCalls.length, supported.length);
});

test('non-reservation lookalikes remain outside reservation authority', async () => {
  let providerCalls = 0;
  const original = new Response('{}', { status: 200 });
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => {
    providerCalls += 1;
    return original;
  }) as typeof fetch);

  const response = await wrapped(
    'https://api.pp.travelport.net/11/hotel/book/reservations-legacy',
    requestInit('POST'),
  );
  assert.equal(response, original);
  assert.equal(providerCalls, 1);
});
