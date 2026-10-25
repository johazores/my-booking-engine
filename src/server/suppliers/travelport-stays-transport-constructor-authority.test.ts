import assert from 'node:assert/strict';
import test from 'node:test';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysOAuthCredentialContainmentFetch } from './travelport-stays-oauth-credential-containment-fetch.ts';
import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';
import { assertTravelportStaysTransportRequestReady } from './travelport-stays-transport-preflight.ts';
import { materializeTravelportStaysTransportConstructorAuthority } from './travelport-stays-transport-constructor-authority.ts';

const original = Object.freeze({
  username: 'original-user', password: 'original-password', clientId: 'original-client',
  clientSecret: 'original-secret', accessGroup: 'original-access',
});
function oauthBody(values: typeof original) {
  return new URLSearchParams({
    grant_type: 'password', username: values.username, password: values.password,
    client_id: values.clientId, client_secret: values.clientSecret,
  });
}
function invalidRequest(error: unknown) {
  assert.ok(error instanceof HospitalitySupplierProviderError);
  assert.equal(error.code, 'INVALID_REQUEST');
  assert.equal(error.retryable, false);
  assert.ok(!error.message.includes('private diagnostic'));
  return true;
}

test('constructor reads each option and credential field once and freezes its own copy', () => {
  const counts = new Map<string, number>();
  const source = {} as Record<string, string>;
  for (const [key, value] of Object.entries(original)) {
    Object.defineProperty(source, key, {
      enumerable: true,
      get() {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        if (count > 1) throw new Error('private diagnostic');
        return value;
      },
    });
  }
  let environmentReads = 0;
  let credentialReads = 0;
  let fetchReads = 0;
  const fetchImpl = (async () => new Response('{}')) as typeof fetch;
  const authority = materializeTravelportStaysTransportConstructorAuthority({
    get environment() { environmentReads += 1; return 'production' as const; },
    get credentials() { credentialReads += 1; return source; },
    get fetchImpl() { fetchReads += 1; return fetchImpl; },
  });
  assert.deepEqual(authority.credentials, original);
  assert.ok(Object.isFrozen(authority.credentials));
  assert.ok(Object.isFrozen(authority));
  assert.equal(authority.fetchImpl, fetchImpl);
  assert.deepEqual([environmentReads, credentialReads, fetchReads], [1, 1, 1]);
  for (const count of counts.values()) assert.equal(count, 1);
});

test('constructor rejects poisoned getters, revoked proxies, and invalid transport capabilities', () => {
  const revoked = Proxy.revocable(original, {});
  revoked.revoke();
  for (const input of [
    { environment: 'production', credentials: { get password(): never { throw new Error('private diagnostic'); } } },
    { environment: 'production', credentials: revoked.proxy },
    { environment: 'production', credentials: [] },
    { environment: 'production', fetchImpl: {} },
    { get environment(): never { throw new Error('private diagnostic'); } },
  ]) assert.throws(() => materializeTravelportStaysTransportConstructorAuthority(input as never), invalidRequest);
});

test('trace transport keeps original OAuth credential identity after caller mutation', async () => {
  const mutable = { ...original };
  let calls = 0;
  const traced = createTravelportStaysTraceFetch({
    environment: 'production', credentials: mutable,
    fetchImpl: (async () => { calls += 1; return new Response('{}'); }) as typeof fetch,
  });
  mutable.password = 'changed-password';
  const init = (values: typeof original): RequestInit => ({
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: oauthBody(values),
  });
  await traced('https://auth.travelport.net/oauth/token', init(original));
  await assert.rejects(traced('https://auth.travelport.net/oauth/token', init(mutable)), invalidRequest);
  assert.equal(calls, 1);
});

test('credential containment keeps original OAuth identity after caller mutation', async () => {
  const mutable = { ...original, environment: 'production' as const };
  let calls = 0;
  const contained = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production', credentials: mutable,
    fetchImpl: (async () => { calls += 1; return new Response('{}'); }) as typeof fetch,
  });
  mutable.clientSecret = 'changed-secret';
  const init = (values: typeof original): RequestInit => ({
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: oauthBody(values),
  });
  await contained('https://auth.travelport.net/oauth/token', init(original));
  await assert.rejects(contained('https://auth.travelport.net/oauth/token', init(mutable)), invalidRequest);
  assert.equal(calls, 1);
});

test('both transport constructors reject poisoned credentials before network I/O', () => {
  const poisoned = {
    environment: 'production' as const,
    credentials: { ...original, get password(): never { throw new Error('private diagnostic'); } },
  };
  assert.throws(() => createTravelportStaysTraceFetch(poisoned), invalidRequest);
  assert.throws(() => createTravelportStaysOAuthCredentialContainmentFetch(poisoned), invalidRequest);
});

test('preflight snapshots top-level credential source once', async () => {
  const credentials = Object.freeze({ ...original, environment: 'production' as const });
  let reads = 0;
  const request = {
    get credentials() {
      reads += 1;
      if (reads > 1) throw new Error('private diagnostic');
      return credentials;
    },
    requestInput: 'https://api.travelport.net/11/hotel/book/reservations/build',
    init: {
      method: 'POST',
      headers: {
        Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate',
        'Cache-Control': 'no-cache', 'Content-Type': 'application/json',
        Authorization: 'Bearer token', XAUTH_TRAVELPORT_ACCESSGROUP: original.accessGroup,
        E2ETrackingID: 'sf-123e4567-e89b-42d3-a456-426614174000',
        username: original.username, password: original.password,
        client_id: original.clientId, client_secret: original.clientSecret,
      },
      body: '{}',
    },
  };
  await assert.doesNotReject(assertTravelportStaysTransportRequestReady(request));
  assert.equal(reads, 1);
  await assert.rejects(assertTravelportStaysTransportRequestReady({
    ...request, get credentials(): never { throw new Error('private diagnostic'); },
  }), invalidRequest);
});
