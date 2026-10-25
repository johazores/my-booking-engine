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

test('reservation trace snapshots request metadata once and drops unreviewed caller extensions', async () => {
  let delegated = 0;
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async (_input, init) => {
    delegated += 1;
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, '{}');
    assert.equal(new Headers(init?.headers).get('TraceId'), traceId);
    assert.equal('dispatcher' in (init ?? {}), false);
    return reservationResponse();
  }) as typeof fetch);
  const values = {
    method: 'POST',
    headers: new Headers({ E2ETrackingID: `sf-${traceId}` }),
    body: '{}',
    signal: new AbortController().signal,
  };
  const reads: Record<string, number> = {};
  const init: RequestInit = {};
  for (const key of ['method', 'headers', 'body', 'signal'] as const) {
    Object.defineProperty(init, key, {
      get() {
        reads[key] = (reads[key] ?? 0) + 1;
        if (reads[key] !== 1) throw new Error('private secret');
        return values[key];
      },
    });
  }
  Object.defineProperty(init, 'dispatcher', { get() { throw new Error('unreviewed extension'); } });
  await wrapped(url, init);
  assert.equal(delegated, 1);
  assert.deepEqual(reads, { method: 1, headers: 1, body: 1, signal: 1 });
});

test('reservation trace rejects hostile request metadata before provider I/O', async () => {
  let delegated = 0;
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => {
    delegated += 1;
    return reservationResponse();
  }) as typeof fetch);
  const badHeaders: RequestInit = { method: 'POST', body: '{}' };
  Object.defineProperty(badHeaders, 'headers', { get() { throw new Error('private secret'); } });
  const badBody: RequestInit = { method: 'POST', headers: { E2ETrackingID: `sf-${traceId}` } };
  Object.defineProperty(badBody, 'body', { get() { throw new Error('private secret'); } });
  const badSignal: RequestInit = { method: 'POST', headers: { E2ETrackingID: `sf-${traceId}` }, body: '{}' };
  Object.defineProperty(badSignal, 'signal', { get() { throw new Error('private secret'); } });
  const invalidMethod: RequestInit = {
    method: 42 as unknown as string, headers: { E2ETrackingID: `sf-${traceId}` }, body: '{}',
  };
  const revoked = Proxy.revocable({ method: 'POST', headers: { E2ETrackingID: `sf-${traceId}` }, body: '{}' }, {});
  revoked.revoke();
  for (const init of [badHeaders, badBody, badSignal, invalidMethod, revoked.proxy]) {
    await assert.rejects(wrapped(url, init), (error: unknown) => {
      assert.ok(error instanceof HospitalitySupplierProviderError);
      assert.equal(error.code, 'INVALID_REQUEST');
      assert.ok(!error.message.includes('private secret'));
      return true;
    });
  }
  assert.equal(delegated, 0);
});
