import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysOAuthCredentialContainmentFetch } from './travelport-stays-oauth-credential-containment-fetch.ts';

const credentials = Object.freeze({
  environment: 'production' as const,
  username: 'test-user',
  password: 'test-password',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  accessGroup: 'test-access-group',
});

function requestHeaders(overrides: Readonly<Record<string, string>> = {}) {
  return {
    Accept: 'application/json',
    Authorization: 'Bearer test-token',
    XAUTH_TRAVELPORT_ACCESSGROUP: credentials.accessGroup,
    E2ETrackingID: 'sf-123e4567-e89b-42d3-a456-426614174000',
    username: credentials.username,
    password: credentials.password,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    ...overrides,
  };
}

function assertInvalidRequest(error: unknown) {
  if (!(error instanceof HospitalitySupplierProviderError)) return false;
  assert.equal(error.code, 'INVALID_REQUEST');
  assert.equal(error.retryable, false);
  return true;
}

test('removes long-lived OAuth credential headers before Travelport Stays network I/O', async () => {
  let observedHeaders: Headers | null = null;
  const sourceHeaders = requestHeaders();
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    observedHeaders = new Headers(init?.headers);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl,
  });

  await containedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    headers: sourceHeaders,
    body: '{}',
  });

  const terminalHeaders = observedHeaders;
  assert.ok(terminalHeaders);
  for (const name of ['username', 'password', 'client_id', 'client_secret']) {
    assert.equal(terminalHeaders.get(name), null);
  }
  assert.equal(terminalHeaders.get('Authorization'), 'Bearer test-token');
  assert.equal(terminalHeaders.get('XAUTH_TRAVELPORT_ACCESSGROUP'), credentials.accessGroup);
  assert.equal(sourceHeaders.username, credentials.username);
  assert.equal(sourceHeaders.client_secret, credentials.clientSecret);
});

test('accepts future Stays builders that already omit long-lived OAuth credential headers', async () => {
  let calls = 0;
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer test-token');
    assert.equal(headers.get('XAUTH_TRAVELPORT_ACCESSGROUP'), credentials.accessGroup);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({ environment: 'production', credentials, fetchImpl });
  const { username: _username, password: _password, client_id: _clientId, client_secret: _clientSecret, ...cleanHeaders } = requestHeaders();

  await containedFetch('https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest', {
    method: 'POST',
    headers: cleanHeaders,
    body: '{}',
  });
  assert.equal(calls, 1);
});

test('rejects mismatched or partial long-lived credential headers before network I/O', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({ environment: 'production', credentials, fetchImpl });

  await assert.rejects(
    containedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST',
      headers: requestHeaders({ client_secret: 'other-secret' }),
      body: '{}',
    }),
    assertInvalidRequest,
  );

  const partial = requestHeaders();
  delete (partial as Partial<typeof partial>).password;
  await assert.rejects(
    containedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST',
      headers: partial,
      body: '{}',
    }),
    assertInvalidRequest,
  );
  assert.equal(calls, 0);
});

test('rejects a Stays access-group mismatch before network I/O', async () => {
  let calls = 0;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });

  await assert.rejects(
    containedFetch('https://api.travelport.net/11/hotel/book/reservations/build', {
      method: 'POST',
      headers: requestHeaders({ XAUTH_TRAVELPORT_ACCESSGROUP: 'other-group' }),
      body: '{}',
    }),
    assertInvalidRequest,
  );
  assert.equal(calls, 0);
});

test('never forwards long-lived credential headers to a foreign host', async () => {
  let calls = 0;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });

  await assert.rejects(
    containedFetch('https://example.com/hotel', { headers: requestHeaders() }),
    assertInvalidRequest,
  );
  assert.equal(calls, 0);
});

test('leaves the OAuth token request body path unchanged when credentials are not headers', async () => {
  let observedBody: BodyInit | null | undefined;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedBody = init?.body;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  const body = new URLSearchParams({
    grant_type: 'password',
    username: credentials.username,
    password: credentials.password,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });

  await containedFetch('https://auth.travelport.net/oauth/token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  assert.equal(observedBody, body);
});
