import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { assertTravelportStaysAbortSignalReady } from './travelport-stays-abort-signal-authority.ts';
import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';
import { createTravelportStaysOAuthCredentialContainmentFetch } from './travelport-stays-oauth-credential-containment-fetch.ts';
import { createTravelportStaysReservationTraceAuthorityFetch } from './travelport-stays-reservation-trace-fetch.ts';
import { assertTravelportStaysTransportRequestReady } from './travelport-stays-transport-preflight.ts';

const TRACE_ID = '123e4567-e89b-42d3-a456-426614174000';
const credentials = Object.freeze({
  environment: 'production' as const,
  username: 'test-user',
  password: 'test-password',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  accessGroup: 'test-access-group',
});

function invalidRequest(error: unknown) {
  assert.ok(error instanceof HospitalitySupplierProviderError);
  assert.equal(error.code, 'INVALID_REQUEST');
  assert.equal(error.retryable, false);
  return true;
}

function headers() {
  return {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token',
    XAUTH_TRAVELPORT_ACCESSGROUP: credentials.accessGroup,
    E2ETrackingID: `sf-${TRACE_ID}`,
    username: credentials.username,
    password: credentials.password,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  };
}

function invalidSignals(): AbortSignal[] {
  const forged = Object.create(AbortSignal.prototype) as AbortSignal;
  const throwing = { get aborted() { throw new Error('private caller data'); } } as AbortSignal;
  return [AbortSignal.abort('already cancelled'), forged, throwing, {} as AbortSignal];
}

test('accepts absent and active native signals; rejects aborted and forged signal authority', () => {
  const active = new AbortController().signal;
  assert.doesNotThrow(() => assertTravelportStaysAbortSignalReady(undefined));
  assert.doesNotThrow(() => assertTravelportStaysAbortSignalReady(null));
  assert.doesNotThrow(() => assertTravelportStaysAbortSignalReady(active));
  for (const signal of invalidSignals()) {
    assert.throws(() => assertTravelportStaysAbortSignalReady(signal), invalidRequest);
  }
});

test('shared trace transport rejects invalid signals before network I/O and preserves active signal identity', async () => {
  let calls = 0;
  let forwarded: AbortSignal | null | undefined;
  const traced = createTravelportStaysTraceFetch({
    environment: 'production',
    fetchImpl: (async (_url, init) => {
      calls += 1;
      forwarded = init?.signal;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  const url = 'https://api.travelport.net/12/hotel/search/searchcomplete';
  for (const signal of invalidSignals()) {
    await assert.rejects(traced(url, {
      method: 'POST', headers: { E2ETrackingID: `sf-${TRACE_ID}`, 'Content-Type': 'application/json' },
      body: '{}', signal,
    }), invalidRequest);
  }
  assert.equal(calls, 0);
  const active = new AbortController().signal;
  await traced(url, {
    method: 'POST', headers: { E2ETrackingID: `sf-${TRACE_ID}`, 'Content-Type': 'application/json' },
    body: '{}', signal: active,
  });
  assert.equal(calls, 1);
  assert.equal(forwarded, active);
});

test('terminal credential containment rejects invalid signals before provider I/O', async () => {
  let calls = 0;
  let forwarded: AbortSignal | null | undefined;
  const contained = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production', credentials,
    fetchImpl: (async (_url, init) => {
      calls += 1;
      forwarded = init?.signal;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  const url = 'https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest';
  for (const signal of invalidSignals()) {
    await assert.rejects(contained(url, {
      method: 'POST', headers: headers(), body: '{}', signal,
    }), invalidRequest);
  }
  assert.equal(calls, 0);
  const active = new AbortController().signal;
  await contained(url, { method: 'POST', headers: headers(), body: '{}', signal: active });
  assert.equal(calls, 1);
  assert.equal(forwarded, active);
});

test('reservation trace rejects malformed signal before delegated transport', async () => {
  let calls = 0;
  const traced = createTravelportStaysReservationTraceAuthorityFetch((async () => {
    calls += 1;
    return new Response(null, { status: 204 });
  }) as typeof fetch);
  for (const signal of invalidSignals()) {
    await assert.rejects(traced('https://api.travelport.net/11/hotel/book/reservations/build', {
      method: 'POST', headers: headers(), body: '{}', signal,
    }), invalidRequest);
  }
  assert.equal(calls, 0);
});

test('no-network write preflight rejects malformed or already-aborted signals', async () => {
  const url = 'https://api.travelport.net/11/hotel/book/reservations/build';
  for (const signal of invalidSignals()) {
    await assert.rejects(assertTravelportStaysTransportRequestReady({
      credentials,
      requestInput: url,
      init: { method: 'POST', headers: headers(), body: '{}', signal },
    }), invalidRequest);
  }
  await assert.doesNotReject(assertTravelportStaysTransportRequestReady({
    credentials,
    requestInput: url,
    init: { method: 'POST', headers: headers(), body: '{}', signal: new AbortController().signal },
  }));
});
