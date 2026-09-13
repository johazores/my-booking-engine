import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysReservationTraceAuthorityFetch } from './travelport-stays-reservation-trace-fetch.ts';

const traceId = '9f77a0b5-2614-4f6d-9053-f3a6175343f7';
const url = 'https://api.pp.travelport.net/11/hotel/book/reservations/build';

function reservationResponse() {
  return new Response(JSON.stringify({ ReservationResponse: { traceId } }), {
    status: 200,
    headers: { traceId, 'Content-Type': 'application/json' },
  });
}

test('materializes the exact v11 reservation TraceId/E2ETrackingID pair before delegated provider I/O', async () => {
  for (const sourceHeaders of [
    new Headers({ E2ETrackingID: `sf-${traceId}` }),
    new Headers({ E2ETrackingID: `sf-${traceId}`, TraceId: 'stale-trace' }),
    new Headers({ E2ETrackingID: `sf-${traceId}`, 'TVP-Trace-Id': 'stale-v12-trace' }),
    new Headers({
      E2ETrackingID: `sf-${traceId}`,
      TraceId: 'stale-trace',
      'TVP-Trace-Id': 'stale-v12-trace',
    }),
  ]) {
    const delegatedHeaders: Headers[] = [];
    const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async (_input, init) => {
      delegatedHeaders.push(new Headers(init?.headers));
      return reservationResponse();
    }) as typeof fetch);

    const response = await wrapped(url, {
      method: 'POST',
      headers: sourceHeaders,
      body: '{}',
    });

    assert.equal(response.status, 200);
    assert.equal(delegatedHeaders[0]?.get('E2ETrackingID'), `sf-${traceId}`);
    assert.equal(delegatedHeaders[0]?.get('TraceId'), traceId);
    assert.equal(delegatedHeaders[0]?.get('TVP-Trace-Id'), null);

    // The authority wrapper owns a cloned effective header set and never mutates caller state.
    if (sourceHeaders.has('TraceId')) assert.equal(sourceHeaders.get('TraceId'), 'stale-trace');
    if (sourceHeaders.has('TVP-Trace-Id')) assert.equal(sourceHeaders.get('TVP-Trace-Id'), 'stale-v12-trace');
  }
});

test('rejects malformed SF reservation correlation before delegated provider I/O', async () => {
  let delegated = false;
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => {
    delegated = true;
    return reservationResponse();
  }) as typeof fetch);

  for (const value of [
    null,
    'not-sf-prefixed',
    'sf-not-a-uuid',
  ]) {
    delegated = false;
    const headers = new Headers();
    if (value !== null) headers.set('E2ETrackingID', value);
    await assert.rejects(
      wrapped(url, { method: 'POST', headers, body: '{}' }),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
    );
    assert.equal(delegated, false, value ?? '<missing>');
  }
});

test('does not rewrite trace headers for non-reservation lookalikes', async () => {
  const sourceHeaders = new Headers({
    E2ETrackingID: `sf-${traceId}`,
    TraceId: 'caller-trace',
    'TVP-Trace-Id': 'caller-v12-trace',
  });
  const delegatedHeaders: Headers[] = [];
  const original = new Response('{}', { status: 200 });
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async (_input, init) => {
    delegatedHeaders.push(new Headers(init?.headers));
    return original;
  }) as typeof fetch);

  const response = await wrapped(
    'https://api.pp.travelport.net/11/hotel/book/reservations-legacy',
    { method: 'POST', headers: sourceHeaders, body: '{}' },
  );

  assert.equal(response, original);
  assert.equal(delegatedHeaders[0]?.get('TraceId'), 'caller-trace');
  assert.equal(delegatedHeaders[0]?.get('TVP-Trace-Id'), 'caller-v12-trace');
});
