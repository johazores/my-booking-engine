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

const preProductionCredentials = Object.freeze({
  ...credentials,
  environment: 'pre-production' as const,
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

function cleanRequestHeaders() {
  const {
    username: _username,
    password: _password,
    client_id: _clientId,
    client_secret: _clientSecret,
    ...cleanHeaders
  } = requestHeaders();
  return cleanHeaders;
}

function oauthBody(overrides: Readonly<Record<string, string>> = {}) {
  return new URLSearchParams({
    grant_type: 'password',
    username: credentials.username,
    password: credentials.password,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    ...overrides,
  });
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

test('containment accepts a clean Stays header shape when invoked directly', async () => {
  let calls = 0;
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer test-token');
    assert.equal(headers.get('XAUTH_TRAVELPORT_ACCESSGROUP'), credentials.accessGroup);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({ environment: 'production', credentials, fetchImpl });

  await containedFetch('https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest', {
    method: 'POST',
    headers: cleanRequestHeaders(),
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

test('never forwards Travelport requests to a foreign or malformed target', async () => {
  let calls = 0;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });

  for (const target of ['https://example.com/hotel', 'not-a-valid-url']) {
    await assert.rejects(containedFetch(target, { headers: cleanRequestHeaders() }), assertInvalidRequest);
  }
  await assert.rejects(
    containedFetch('https://example.com/oauth/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: oauthBody(),
    }),
    assertInvalidRequest,
  );
  assert.equal(calls, 0);
});


test('normalizes malformed header input as a provider request failure before network I/O', async () => {
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
    containedFetch('https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token\nother' },
      body: '{}',
    }),
    assertInvalidRequest,
  );
  assert.equal(calls, 0);
});

test('requires the configured Stays host to use a secure canonical HTTPS origin before network I/O', async () => {
  let calls = 0;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  const headers = cleanRequestHeaders();
  const invalidTargets = [
    'http://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest',
    'https://api.travelport.net:444/11/hotel/rules/offershospitality/buildfromrequest',
    'https://user@api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest',
    'https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest#fragment',
  ];

  for (const target of invalidTargets) {
    await assert.rejects(containedFetch(target, { method: 'POST', headers, body: '{}' }), assertInvalidRequest);
  }
  assert.equal(calls, 0);
});

test('pins Stays authority to the Hotel product namespace on the shared Travelport API host', async () => {
  let calls = 0;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });

  for (const target of [
    'https://api.travelport.net/11/air/book/reservation/reservations/ABC123',
    'https://api.travelport.net/11/air/catalog/search/catalogproductofferings',
    'https://api.travelport.net/oauth/token',
  ]) {
    await assert.rejects(
      containedFetch(target, { method: 'GET', headers: cleanRequestHeaders() }),
      assertInvalidRequest,
    );
  }
  assert.equal(calls, 0);
});

test('applies the same Hotel namespace boundary in pre-production', async () => {
  let calls = 0;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'pre-production',
    credentials: preProductionCredentials,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });

  await containedFetch('https://api.pp.travelport.net/11/hotel/rules/offershospitality/buildfromrequest', {
    method: 'POST',
    headers: cleanRequestHeaders(),
    body: '{}',
  });
  await containedFetch('https://auth.pp.travelport.net/oauth/token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: oauthBody(),
  });
  await assert.rejects(
    containedFetch('https://api.pp.travelport.net/11/air/book/reservation/reservations/ABC123', {
      method: 'GET',
      headers: cleanRequestHeaders(),
    }),
    assertInvalidRequest,
  );
  assert.equal(calls, 2);
});

test('keeps the OAuth credential exchange on the exact configured authentication target', async () => {
  let calls = 0;
  let observedBody: BodyInit | null | undefined;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      observedBody = init?.body;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  const body = oauthBody();

  await containedFetch('https://auth.travelport.net/oauth/token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  assert.equal(observedBody, body);
  assert.equal(calls, 1);

  const invalidTargets = [
    'http://auth.travelport.net/oauth/token',
    'https://auth.travelport.net:444/oauth/token',
    'https://user@auth.travelport.net/oauth/token',
    'https://auth.travelport.net/oauth/token?scope=other',
    'https://auth.travelport.net/oauth/token#fragment',
    'https://auth.travelport.net/other',
    'https://auth.pp.travelport.net/oauth/token',
  ];
  for (const target of invalidTargets) {
    await assert.rejects(
      containedFetch(target, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: oauthBody(),
      }),
      assertInvalidRequest,
    );
  }
  assert.equal(calls, 1);
});

test('requires exact active OAuth credential authority at the terminal boundary', async () => {
  let calls = 0;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  const headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };

  for (const body of [
    oauthBody({ client_secret: 'other-secret' }),
    new URLSearchParams({
      grant_type: 'password',
      username: credentials.username,
      password: credentials.password,
      client_id: credentials.clientId,
    }),
    new URLSearchParams({
      grant_type: 'client_credentials',
      username: credentials.username,
      password: credentials.password,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  ]) {
    await assert.rejects(
      containedFetch('https://auth.travelport.net/oauth/token', { method: 'POST', headers, body }),
      assertInvalidRequest,
    );
  }

  await assert.rejects(
    containedFetch('https://auth.travelport.net/oauth/token', {
      method: 'GET',
      headers,
      body: oauthBody(),
    }),
    assertInvalidRequest,
  );
  await assert.rejects(
    containedFetch('https://auth.travelport.net/oauth/token', {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer not-valid-on-oauth' },
      body: oauthBody(),
    }),
    assertInvalidRequest,
  );
  assert.equal(calls, 0);
});

test('terminal containment reasserts network-safe fetch metadata for OAuth and Stays', async () => {
  const calls: RequestInit[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(init);
    calls.push(init);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl,
  });
  const controller = new AbortController();
  const unsafeCommon = {
    cache: 'force-cache',
    credentials: 'include',
    redirect: 'follow',
    referrer: 'https://internal.example/private',
    referrerPolicy: 'unsafe-url',
    keepalive: true,
    integrity: 'sha256-not-provider-authority',
    dispatcher: { route: 'unreviewed-proxy' },
    next: { revalidate: 60 },
  } as RequestInit & { dispatcher: unknown; next: unknown };

  await containedFetch('https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest', {
    ...unsafeCommon,
    method: 'post',
    signal: controller.signal,
    headers: requestHeaders(),
    body: '{}',
  });
  await containedFetch('https://auth.travelport.net/oauth/token', {
    ...unsafeCommon,
    method: 'post',
    signal: controller.signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: oauthBody(),
  });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.method, 'POST');
    assert.equal(call.cache, 'no-store');
    assert.equal(call.credentials, 'omit');
    assert.equal(call.redirect, 'manual');
    assert.equal(call.referrer, '');
    assert.equal(call.referrerPolicy, 'no-referrer');
    assert.equal(call.keepalive, false);
    assert.equal(call.integrity, '');
    assert.equal(call.signal, controller.signal);
    assert.equal('dispatcher' in call, false);
    assert.equal('next' in call, false);
  }
  assert.equal(calls[0]?.body, '{}');
  assert.ok(calls[1]?.body instanceof URLSearchParams);
  const staysHeaders = new Headers(calls[0]?.headers);
  assert.equal(staysHeaders.get('username'), null);
  assert.equal(staysHeaders.get('password'), null);
  assert.equal(staysHeaders.get('client_id'), null);
  assert.equal(staysHeaders.get('client_secret'), null);
});

test('terminal containment rejects unreviewed explicit headers before OAuth or Stays network I/O', async () => {
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
    containedFetch('https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest', {
      method: 'POST',
      headers: { ...cleanRequestHeaders(), Cookie: 'sf_session=must-not-leak' },
      body: '{}',
    }),
    assertInvalidRequest,
  );
  await assert.rejects(
    containedFetch('https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest', {
      method: 'POST',
      headers: { ...cleanRequestHeaders(), 'X-Internal-Api-Key': 'must-not-leak' },
      body: '{}',
    }),
    assertInvalidRequest,
  );
  await assert.rejects(
    containedFetch('https://auth.travelport.net/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Proxy-Authorization': 'Basic must-not-leak',
      },
      body: oauthBody(),
    }),
    assertInvalidRequest,
  );
  assert.equal(calls, 0);
});
