import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysReservationTraceAuthorityFetch } from './travelport-stays-reservation-trace-fetch.ts';

const traceId = '9f77a0b5-2614-4f6d-9053-f3a6175343f7';

function requestInit(method: 'GET' | 'POST' = 'POST'): RequestInit {
  return {
    method,
    headers: { E2ETrackingID: `sf-${traceId}` },
    ...(method === 'POST' ? { body: '{}' } : {}),
  };
}

function reservationResponse(input: Readonly<{
  payloadTrace?: unknown;
  headerTrace?: string | null;
  family?: 'ReservationResponse' | 'ErrorResponse';
  status?: number;
}> = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const headerTrace = input.headerTrace === undefined ? traceId : input.headerTrace;
  if (headerTrace !== null) headers.set('traceId', headerTrace);
  const family = input.family ?? 'ReservationResponse';
  return new Response(JSON.stringify({
    [family]: {
      traceId: input.payloadTrace === undefined ? traceId : input.payloadTrace,
      marker: 'preserved',
    },
  }), { status: input.status ?? (family === 'ErrorResponse' ? 400 : 200), headers });
}

async function assertInvalidResponse(response: Response) {
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => response) as typeof fetch);
  await assert.rejects(
    wrapped('https://api.pp.travelport.net/11/hotel/book/reservations/build', requestInit()),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
}

test('accepts exact response-header and payload trace echoes and preserves the response for downstream parsing', async () => {
  for (const family of ['ReservationResponse', 'ErrorResponse'] as const) {
    const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => reservationResponse({ family })) as typeof fetch);
    const response = await wrapped(
      family === 'ReservationResponse'
        ? 'https://api.pp.travelport.net/11/hotel/book/reservations/build'
        : 'https://api.pp.travelport.net/11/hotel/book/reservations/',
      requestInit(),
    );
    assert.equal(response.status, family === 'ErrorResponse' ? 400 : 200);
    assert.equal(response.headers.get('traceId'), traceId);
    assert.equal((await response.json() as { [key: string]: { marker: string } })[family]?.marker, 'preserved');
  }
});

test('trace-binds HTTP 500 reservation error evidence before it can affect commercial classification', async () => {
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch(
    (async () => reservationResponse({ family: 'ErrorResponse', status: 500 })) as typeof fetch,
  );
  const accepted = await wrapped(
    'https://api.pp.travelport.net/11/hotel/book/reservations/build',
    requestInit(),
  );
  assert.equal(accepted.status, 500);
  assert.equal(accepted.headers.get('traceId'), traceId);
  assert.equal((await accepted.json() as { ErrorResponse?: { marker?: string } }).ErrorResponse?.marker, 'preserved');

  await assertInvalidResponse(reservationResponse({
    family: 'ErrorResponse',
    status: 500,
    headerTrace: null,
  }));
  await assertInvalidResponse(reservationResponse({
    family: 'ErrorResponse',
    status: 500,
    payloadTrace: '11111111-1111-4111-8111-111111111111',
  }));
});

test('fails closed when either provider trace echo is missing or mismatched', async () => {
  for (const response of [
    reservationResponse({ headerTrace: null }),
    reservationResponse({ headerTrace: '11111111-1111-4111-8111-111111111111' }),
    reservationResponse({ payloadTrace: null }),
    reservationResponse({ payloadTrace: '11111111-1111-4111-8111-111111111111' }),
  ]) await assertInvalidResponse(response);
});

test('fails closed for malformed or undocumented response payload correlation', async () => {
  await assertInvalidResponse(new Response('{', { status: 200, headers: { traceId } }));
  await assertInvalidResponse(new Response(JSON.stringify({ ReservationResponse: { traceID: traceId } }), {
    status: 200,
    headers: { traceId },
  }));
});

test('passes non-reservation Stays traffic through without consuming or rewriting its response', async () => {
  const original = new Response(JSON.stringify({ RulesResponse: { traceId: 'provider-generated' } }), { status: 200 });
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => original) as typeof fetch);
  const response = await wrapped(
    'https://api.pp.travelport.net/11/hotel/rules/offershospitality/buildfromrequest',
    requestInit(),
  );
  assert.equal(response, original);
  assert.deepEqual(await response.json(), { RulesResponse: { traceId: 'provider-generated' } });
});

test('preserves auth, rate-limit, and provider-unavailable statuses above 500 without requiring payload authority', async () => {
  for (const status of [401, 403, 429, 503]) {
    const original = new Response('{}', { status });
    const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => original) as typeof fetch);
    const response = await wrapped(
      'https://api.pp.travelport.net/11/hotel/book/reservations/build',
      requestInit(),
    );
    assert.equal(response, original);
    assert.equal(response.status, status);
  }
});

test('rejects malformed SF reservation correlation even when used without the shared transport wrapper', async () => {
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => reservationResponse()) as typeof fetch);
  await assert.rejects(
    wrapped('https://api.pp.travelport.net/11/hotel/book/reservations/build', {
      method: 'POST',
      headers: { E2ETrackingID: 'sf-not-a-uuid' },
      body: '{}',
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
});
