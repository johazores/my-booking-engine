import assert from 'node:assert/strict';
import test from 'node:test';

import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';

const TRACE_ID = '123e4567-e89b-42d3-a456-426614174000';

test('projects only reviewed RequestInit fields into credentialed Travelport transport', async () => {
  const calls: Array<RequestInit & Record<string, unknown>> = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push((init ?? {}) as RequestInit & Record<string, unknown>);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });
  const controller = new AbortController();
  const body = '{}';
  const callerInit = {
    method: 'POST',
    headers: {
      E2ETrackingID: `sf-${TRACE_ID}`,
      'Content-Type': 'application/json',
    },
    body,
    signal: controller.signal,
    dispatcher: { unsafe: true },
    agent: { unsafe: true },
    next: { revalidate: 1 },
    mode: 'no-cors',
    priority: 'high',
    window: null,
  } as RequestInit & Record<string, unknown>;

  await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', callerInit);

  assert.equal(calls.length, 1);
  const forwarded = calls[0];
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
