import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';

const TRACE_ID = '123e4567-e89b-42d3-a456-426614174000';

const BOUND_CREDENTIALS = Object.freeze({
  username: 'test-user',
  password: 'test-password',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  accessGroup: 'test-access-group',
});

function assertInvalidRequest(error: unknown) {
  assert.ok(error instanceof HospitalitySupplierProviderError);
  assert.equal(error.code, 'INVALID_REQUEST');
  assert.equal(error.retryable, false);
  return true;
}

function oauthBody() {
  return new URLSearchParams({
    grant_type: 'password',
    username: 'test-user',
    password: 'test-password',
    client_id: 'test-client',
    client_secret: 'test-secret',
  });
}

function staysHeaders(extra: Readonly<Record<string, string>> = {}) {
  return {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token',
    XAUTH_TRAVELPORT_ACCESSGROUP: 'test-access-group',
    E2ETrackingID: `sf-${TRACE_ID}`,
    username: 'test-user',
    password: 'test-password',
    client_id: 'test-client',
    client_secret: 'test-secret',
    ...extra,
  };
}

test('accepts only reviewed OAuth and Stays header channels', async () => {
  const calls: Array<RequestInit | undefined> = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });

  await tracedFetch('https://auth.travelport.net/oauth/token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: oauthBody(),
  });
  await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    headers: staysHeaders({ 'TVP-Cache-Control': 'no-cache' }),
    body: '{}',
  });

  assert.equal(calls.length, 2);
});

test('rejects arbitrary caller headers before credentialed Travelport I/O', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });

  for (const [name, value] of [
    ['X-Internal-Api-Key', 'internal-secret'],
    ['X-SF-Session', 'session-secret'],
    ['Sec-Fetch-Site', 'same-origin'],
    ['CF-Connecting-IP', '127.0.0.1'],
    ['X-Request-ID', 'unreviewed-correlation-channel'],
  ] as const) {
    await assert.rejects(
      tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
        method: 'POST',
        headers: staysHeaders({ [name]: value }),
        body: '{}',
      }),
      assertInvalidRequest,
    );
  }

  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Internal-Api-Key': 'internal-secret',
      },
      body: oauthBody(),
    }),
    assertInvalidRequest,
  );

  assert.equal(calls, 0);
});

test('rejects non-canonical values on reviewed Travelport header channels', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });

  const invalidHeaderOverrides: ReadonlyArray<Readonly<Record<string, string>>> = [
    { Accept: 'text/plain' },
    { 'Accept-Encoding': 'br' },
    { 'Cache-Control': 'max-age=60' },
    { Authorization: 'Basic not-a-travelport-token' },
    { Authorization: `Bearer ${'x'.repeat(16_385)}` },
    { XAUTH_TRAVELPORT_ACCESSGROUP: 'x'.repeat(513) },
    { username: 'x'.repeat(513) },
    { password: 'x'.repeat(4097) },
    { client_id: 'x'.repeat(513) },
    { client_secret: 'x'.repeat(4097) },
  ];
  for (const override of invalidHeaderOverrides) {
    await assert.rejects(
      tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
        method: 'POST',
        headers: staysHeaders(override),
        body: '{}',
      }),
      assertInvalidRequest,
    );
  }

  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', {
      method: 'POST',
      headers: { Accept: 'text/plain', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: oauthBody(),
    }),
    assertInvalidRequest,
  );

  assert.equal(calls, 0);
});

test('limits TVP cache-control to the SearchComplete request that owns it', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });

  await assert.rejects(
    tracedFetch('https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest', {
      method: 'POST',
      headers: staysHeaders({ 'TVP-Cache-Control': 'no-cache' }),
      body: '{}',
    }),
    assertInvalidRequest,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST',
      headers: staysHeaders({ 'TVP-Cache-Control': 'max-age=60' }),
      body: '{}',
    }),
    assertInvalidRequest,
  );

  assert.equal(calls, 0);
});


test('binds OAuth and Stays static credentials to the configured integration', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({
    environment: 'production',
    credentials: BOUND_CREDENTIALS,
    fetchImpl,
  });

  const mismatchedOAuth = oauthBody();
  mismatchedOAuth.set('client_id', 'other-client');
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: mismatchedOAuth,
    }),
    assertInvalidRequest,
  );
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: oauthBody(),
    }),
    assertInvalidRequest,
  );

  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST',
      headers: staysHeaders({ XAUTH_TRAVELPORT_ACCESSGROUP: 'other-access-group' }),
      body: '{}',
    }),
    assertInvalidRequest,
  );
  const { Authorization: _authorization, ...missingAuthorization } = staysHeaders();
  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST',
      headers: missingAuthorization,
      body: '{}',
    }),
    assertInvalidRequest,
  );

  await tracedFetch('https://auth.travelport.net/oauth/token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: oauthBody(),
  });
  await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    headers: staysHeaders(),
    body: '{}',
  });

  assert.equal(calls, 2);
});
