import assert from 'node:assert/strict';
import test from 'node:test';

import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';

const TRACE_ID = '123e4567-e89b-42d3-a456-426614174000';
const BOUND_CREDENTIALS = Object.freeze({
  username: 'test-user',
  password: 'test-password',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  accessGroup: 'test-access-group',
});

function staysHeaders() {
  return {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token',
    XAUTH_TRAVELPORT_ACCESSGROUP: BOUND_CREDENTIALS.accessGroup,
    E2ETrackingID: `sf-${TRACE_ID}`,
    username: BOUND_CREDENTIALS.username,
    password: BOUND_CREDENTIALS.password,
    client_id: BOUND_CREDENTIALS.clientId,
    client_secret: BOUND_CREDENTIALS.clientSecret,
  };
}

test('projects only reviewed RequestInit fields into credentialed Travelport transport', async () => {
  const calls: Array<Readonly<{ input: RequestInfo | URL; init: RequestInit & Record<string, unknown> }>> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init: (init ?? {}) as RequestInit & Record<string, unknown> });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({
    environment: 'production',
    credentials: BOUND_CREDENTIALS,
    fetchImpl,
  });
  const controller = new AbortController();
  const body = '{}';
  const callerInit = {
    method: 'POST',
    headers: staysHeaders(),
    body,
    signal: controller.signal,
    dispatcher: { unsafe: true },
    agent: { unsafe: true },
    next: { revalidate: 1 },
    mode: 'no-cors',
    priority: 'high',
    window: null,
  } as RequestInit & Record<string, unknown>;

  const url = 'https://api.travelport.net/12/hotel/search/searchcomplete';
  await tracedFetch(url, callerInit);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, url);
  const forwarded = calls[0]!.init;
  assert.equal(forwarded.method, 'POST');
  assert.equal(forwarded.body, body);
  assert.equal(forwarded.signal, controller.signal);
  assert.equal(forwarded.cache, 'no-store');
  assert.equal(forwarded.credentials, 'omit');
  assert.equal(forwarded.redirect, 'manual');
  assert.equal(forwarded.referrer, '');
  assert.equal(forwarded.referrerPolicy, 'no-referrer');
  assert.equal(forwarded.keepalive, false);
  assert.equal(forwarded.integrity, '');
  assert.ok(forwarded.headers instanceof Headers);

  for (const key of ['dispatcher', 'agent', 'next', 'mode', 'priority', 'window']) {
    assert.equal(key in forwarded, false, `${key} must not cross the credentialed transport boundary`);
  }
});

test('rebuilds Request inputs from reviewed URL method headers and signal', async () => {
  const calls: Array<Readonly<{ input: RequestInfo | URL; init: RequestInit }>> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init: init ?? {} });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({
    environment: 'production',
    credentials: BOUND_CREDENTIALS,
    fetchImpl,
  });
  const url = 'https://api.travelport.net/11/hotel/book/reservations/ABC123';
  const request = new Request(url, {
    method: 'GET',
    headers: staysHeaders(),
    cache: 'reload',
    credentials: 'include',
    redirect: 'follow',
    referrer: 'https://example.com/source',
    referrerPolicy: 'unsafe-url',
  });

  await tracedFetch(request);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, url);
  const forwarded = calls[0]!.init;
  assert.equal(forwarded.method, 'GET');
  assert.equal(forwarded.body, undefined);
  assert.equal(forwarded.signal, request.signal);
  assert.equal(forwarded.cache, 'no-store');
  assert.equal(forwarded.credentials, 'omit');
  assert.equal(forwarded.redirect, 'manual');
  assert.equal(forwarded.referrer, '');
  assert.equal(forwarded.referrerPolicy, 'no-referrer');
  assert.equal(forwarded.keepalive, false);
  assert.equal(forwarded.integrity, '');
}
