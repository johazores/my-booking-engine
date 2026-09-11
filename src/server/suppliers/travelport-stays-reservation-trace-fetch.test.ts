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
  v12HeaderTrace?: string | null;
  family?: 'ReservationResponse' | 'ErrorResponse';
  status?: number;
}> = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const headerTrace = input.headerTrace === undefined ? traceId : input.headerTrace;
  if (headerTrace !== null) headers.set('traceId', headerTrace);
  if (input.v12HeaderTrace !== undefined && input.v12HeaderTrace !== null) {
    headers.set('TVP-Trace-Id', input.v12HeaderTrace);
  }
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

test('trace-bound reservation responses also reject normalization-confusable commercial machine authority', async () => {
  for (const [status, family, payload] of [
    [400, 'ErrorResponse', {
      Result: {
        '@type': 'Result',
        Error: [{
          '@type': 'ErrorDetail',
          StatusCode: 400,
          SourceCode: ' 13020',
          category: 'VALIDATION',
          SourceID: 'API',
          Message: 'HOTEL RATE PRICE HAS BECOME',
        }],
      },
    }],
    [200, 'ReservationResponse', {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [{
          '@type': 'Offer',
          Product: [{
            '@type': 'ProductHospitality',
            PropertyKey: { chainCode: ' CN', propertyCode: 'B6381' },
            DateRange: { start: '2026-10-10', end: '2026-10-12' },
          }],
        }],
      },
    }],
  ] as const) {
    const response = new Response(JSON.stringify({
      [family]: { traceId, ...payload },
    }), { status, headers: { traceId, 'Content-Type': 'application/json' } });
    await assertInvalidResponse(response);
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

  await assertInvalidResponse(reservationResponse({ family: 'ErrorResponse', status: 500, headerTrace: null }));
  await assertInvalidResponse(reservationResponse({
    family: 'ErrorResponse',
    status: 500,
    payloadTrace: '11111111-1111-4111-8111-111111111111',
  }));
});

test('fails closed when either provider trace echo is missing, mismatched, or uses a v12-only response header', async () => {
  for (const response of [
    reservationResponse({ headerTrace: null }),
    reservationResponse({ headerTrace: '11111111-1111-4111-8111-111111111111' }),
    reservationResponse({ payloadTrace: null }),
    reservationResponse({ payloadTrace: '11111111-1111-4111-8111-111111111111' }),
    reservationResponse({ v12HeaderTrace: traceId }),
    reservationResponse({ v12HeaderTrace: '11111111-1111-4111-8111-111111111111' }),
  ]) await assertInvalidResponse(response);
});

test('fails closed for malformed or undocumented response payload correlation', async () => {
  await assertInvalidResponse(new Response('{', { status: 200, headers: { traceId } }));
  await assertInvalidResponse(new Response(JSON.stringify({ ReservationResponse: { traceID: traceId } }), {
    status: 200,
    headers: { traceId },
  }));
});

test('passes non-reservation Stays traffic and reservation-prefix lookalikes through unchanged', async () => {
  for (const url of [
    'https://api.pp.travelport.net/11/hotel/rules/offershospitality/buildfromrequest',
    'https://api.pp.travelport.net/11/hotel/book/reservations-legacy',
  ]) {
    const original = new Response(JSON.stringify({ marker: 'provider-generated' }), { status: 200 });
    const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => original) as typeof fetch);
    const response = await wrapped(url, requestInit());
    assert.equal(response, original);
    assert.deepEqual(await response.json(), { marker: 'provider-generated' });
  }
});

test('reduces auth, rate-limit, and provider-unavailable responses above 500 to bounded status-only authority', async () => {
  for (const status of [401, 403, 429, 503]) {
    const original = new Response(JSON.stringify({
      ErrorResponse: {
        traceId: 'untrusted-provider-body-trace',
        Result: {
          '@type': 'Result',
          Error: [{
            '@type': 'ErrorDetail',
            StatusCode: status,
            SourceCode: '13020',
            category: 'VALIDATION',
            SourceID: 'API',
            Message: 'must not become commercial authority',
          }],
        },
      },
    }), {
      status,
      statusText: 'provider supplied detail',
      headers: {
        'Content-Type': 'application/json',
        'Content-Language': 'en',
        'Retry-After': '7',
        'X-Provider-Correlation': 'untrusted-provider-correlation',
        traceId: 'untrusted-provider-header-trace',
        'TVP-Trace-Id': 'untrusted-v12-trace',
      },
    });
    const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => original) as typeof fetch);
    const response = await wrapped(
      'https://api.pp.travelport.net/11/hotel/book/reservations/build',
      requestInit(),
    );
    assert.notEqual(response, original);
    assert.equal(response.status, status);
    assert.equal(response.statusText, '');
    assert.deepEqual([...response.headers.entries()], [['retry-after', '7']]);
    assert.equal(await response.text(), '');
  }
});

test('drops malformed or oversized Retry-After metadata from status-only failures', async () => {
  for (const retryAfter of ['', 'x'.repeat(257)]) {
    const original = new Response('{}', { status: 429, headers: { 'Retry-After': retryAfter } });
    const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => original) as typeof fetch);
    const response = await wrapped(
      'https://api.pp.travelport.net/11/hotel/book/reservations/build',
      requestInit(),
    );
    assert.equal(response.headers.get('Retry-After'), null);
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
