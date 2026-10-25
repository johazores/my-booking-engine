import assert from 'node:assert/strict';
import test from 'node:test';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { materializeTravelportStaysOAuthRequestBody } from './travelport-stays-oauth-request-body.ts';
import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';
import { createTravelportStaysOAuthCredentialContainmentFetch } from './travelport-stays-oauth-credential-containment-fetch.ts';

const credentials = Object.freeze({
  environment: 'production' as const,
  username: 'user', password: 'password', clientId: 'client', clientSecret: 'secret', accessGroup: 'access',
});
const target = 'https://auth.travelport.net/oauth/token';
const headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
function validBody() {
  return new URLSearchParams({
    grant_type: 'password', username: credentials.username, password: credentials.password,
    client_id: credentials.clientId, client_secret: credentials.clientSecret,
  });
}
function invalidRequest(error: unknown) {
  assert.ok(error instanceof HospitalitySupplierProviderError);
  assert.equal(error.code, 'INVALID_REQUEST');
  assert.equal(error.retryable, false);
  assert.ok(!error.message.includes('private secret'));
  return true;
}
test('native OAuth form snapshot ignores overridden methods and caller mutation', () => {
  class PoisonedForm extends URLSearchParams {
    override entries(): ReturnType<URLSearchParams['entries']> { throw new Error('private secret'); }
    override get(_name: string): string | null { throw new Error('private secret'); }
    override toString(): string { throw new Error('private secret'); }
  }
  const source = new PoisonedForm(validBody());
  const snapshot = materializeTravelportStaysOAuthRequestBody(source);
  assert.ok(snapshot);
  assert.notEqual(snapshot.body, source);
  assert.equal(snapshot.body.toString(), validBody().toString());
  source.set('password', 'changed');
  assert.equal(snapshot.body.get('password'), credentials.password);
  assert.ok(Object.isFrozen(snapshot.credentials));
});
test('OAuth form snapshot rejects duplicate, extra, missing, padded, oversized, and proxied fields', () => {
  const duplicate = validBody(); duplicate.append('password', 'other');
  const extra = validBody(); extra.append('scope', 'extra');
  const missing = validBody(); missing.delete('client_id');
  const padded = validBody(); padded.set('username', ' user');
  const oversized = validBody(); oversized.set('client_secret', 'x'.repeat(4097));
  const control = validBody(); control.set('username', 'us\u0000er');
  const inheritedKey = validBody(); inheritedKey.append('__proto__', 'untrusted');
  const revoked = Proxy.revocable(validBody(), {}); revoked.revoke();
  for (const source of [duplicate, extra, missing, padded, oversized, control, inheritedKey, revoked.proxy]) {
    assert.equal(materializeTravelportStaysOAuthRequestBody(source), null);
  }
});
test('trace and containment both forward independent forms and reject spoofed getters', async () => {
  for (const build of [
    (fetchImpl: typeof fetch) => createTravelportStaysTraceFetch({ environment: 'production', credentials, fetchImpl }),
    (fetchImpl: typeof fetch) => createTravelportStaysOAuthCredentialContainmentFetch({ environment: 'production', credentials, fetchImpl }),
  ]) {
    const sent: URLSearchParams[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      assert.ok(init?.body instanceof URLSearchParams);
      sent.push(init.body);
      return new Response('{}');
    }) as typeof fetch;
    const wrapper = build(fetchImpl);
    const source = validBody();
    await wrapper(target, { method: 'POST', headers, body: source });
    assert.equal(sent.length, 1);
    assert.notEqual(sent[0], source);
    source.set('password', 'changed');
    assert.equal(sent[0]?.get('password'), credentials.password);
    class LyingForm extends URLSearchParams {
      override get(name: string): string | null {
        return name === 'password' ? credentials.password : super.get(name);
      }
    }
    const lying = new LyingForm(validBody());
    lying.set('password', 'wrong');
    await assert.rejects(wrapper(target, { method: 'POST', headers, body: lying }), invalidRequest);
    assert.equal(sent.length, 1);
  }
});
test('composed outbound transports preserve the original OAuth authority', async () => {
  let sent: URLSearchParams | null = null;
  const terminal = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(init?.body instanceof URLSearchParams);
    sent = init.body;
    return new Response('{}');
  }) as typeof fetch;
  const contained = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production', credentials, fetchImpl: terminal,
  });
  const traced = createTravelportStaysTraceFetch({
    environment: 'production', credentials, fetchImpl: contained,
  });
  const source = validBody();
  await traced(target, { method: 'POST', headers, body: source });
  assert.ok(sent);
  assert.notEqual(sent, source);
  source.set('client_secret', 'changed');
  assert.equal((sent as URLSearchParams).get('client_secret'), credentials.clientSecret);
});

test('both outbound Travelport transports reject hostile request metadata without leaking errors', async () => {
  for (const build of [
    (fetchImpl: typeof fetch) => createTravelportStaysTraceFetch({ environment: 'production', credentials, fetchImpl }),
    (fetchImpl: typeof fetch) => createTravelportStaysOAuthCredentialContainmentFetch({ environment: 'production', credentials, fetchImpl }),
  ]) {
    let calls = 0;
    const wrapper = build((async () => {
      calls += 1;
      return new Response('{}');
    }) as typeof fetch);
    const poisonedHeaders: RequestInit = { method: 'POST', body: validBody() };
    Object.defineProperty(poisonedHeaders, 'headers', { get() { throw new Error('private secret'); } });
    const poisonedBody: RequestInit = { method: 'POST', headers };
    Object.defineProperty(poisonedBody, 'body', { get() { throw new Error('private secret'); } });
    const poisonedSignal: RequestInit = { method: 'POST', headers, body: validBody() };
    Object.defineProperty(poisonedSignal, 'signal', { get() { throw new Error('private secret'); } });
    const invalidMethod: RequestInit = { method: 42 as unknown as string, headers, body: validBody() };
    const revoked = Proxy.revocable({ method: 'POST', headers, body: validBody() }, {});
    revoked.revoke();
    for (const init of [poisonedHeaders, poisonedBody, poisonedSignal, invalidMethod, revoked.proxy]) {
      await assert.rejects(wrapper(target, init), invalidRequest);
    }
    assert.equal(calls, 0);
  }
});

test('both outbound Travelport transports read each caller request field only once', async () => {
  for (const build of [
    (fetchImpl: typeof fetch) => createTravelportStaysTraceFetch({ environment: 'production', credentials, fetchImpl }),
    (fetchImpl: typeof fetch) => createTravelportStaysOAuthCredentialContainmentFetch({ environment: 'production', credentials, fetchImpl }),
  ]) {
    let calls = 0;
    const wrapper = build((async () => {
      calls += 1;
      return new Response('{}');
    }) as typeof fetch);
    const values = { method: 'POST', headers, body: validBody(), signal: new AbortController().signal };
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
    await wrapper(target, init);
    assert.deepEqual(reads, { method: 1, headers: 1, body: 1, signal: 1 });
    assert.equal(calls, 1);
  }
});
