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

function staysHeaders(authorization = 'Bearer test-token') {
  return {
    Accept: 'application/json',
    Authorization: authorization,
    XAUTH_TRAVELPORT_ACCESSGROUP: credentials.accessGroup,
  };
}

function assertInvalidRequest(error: unknown) {
  if (!(error instanceof HospitalitySupplierProviderError)) return false;
  assert.equal(error.code, 'INVALID_REQUEST');
  assert.equal(error.retryable, false);
  return true;
}

test('terminal Stays boundary requires bounded bearer authorization before network I/O', async () => {
  let calls = 0;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  const target = 'https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest';

  for (const headers of [
    { Accept: 'application/json', XAUTH_TRAVELPORT_ACCESSGROUP: credentials.accessGroup },
    staysHeaders('Basic not-travelport-bearer-authority'),
    staysHeaders('Bearer'),
    staysHeaders('Bearer token with-space'),
    staysHeaders(`Bearer ${'a'.repeat(16_385)}`),
  ]) {
    await assert.rejects(
      containedFetch(target, { method: 'POST', headers, body: '{}' }),
      assertInvalidRequest,
    );
  }

  await containedFetch(target, {
    method: 'POST',
    headers: staysHeaders(`Bearer ${'a'.repeat(16_384)}`),
    body: '{}',
  });
  assert.equal(calls, 1);
});

test('terminal boundary forwards the validated URL string instead of caller Request or URL identity', async () => {
  const observedInputs: Array<RequestInfo | URL> = [];
  const observedInits: RequestInit[] = [];
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      observedInputs.push(input);
      assert.ok(init);
      observedInits.push(init);
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });

  const rulesUrl = new URL('https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest');
  await containedFetch(rulesUrl, {
    method: 'POST',
    headers: staysHeaders(),
    body: '{}',
    cache: 'force-cache',
    credentials: 'include',
    redirect: 'follow',
  });

  const retrieveRequest = new Request(
    'https://api.travelport.net/11/hotel/book/reservations/ABC123',
    {
      method: 'GET',
      headers: staysHeaders(),
      cache: 'force-cache',
      credentials: 'include',
      redirect: 'follow',
      referrer: 'https://internal.example/private',
    },
  );
  await containedFetch(retrieveRequest);

  assert.deepEqual(observedInputs, [
    'https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest',
    'https://api.travelport.net/11/hotel/book/reservations/ABC123',
  ]);
  assert.ok(observedInputs.every((input) => typeof input === 'string'));
  assert.equal(observedInits.length, 2);
  for (const init of observedInits) {
    assert.equal(init.cache, 'no-store');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.referrer, '');
    assert.equal(init.referrerPolicy, 'no-referrer');
  }
});
