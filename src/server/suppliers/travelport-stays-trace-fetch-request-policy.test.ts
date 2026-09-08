import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';

const TRACE_ID = '123e4567-e89b-42d3-a456-426614174000';

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

test('forces process-owned request metadata for OAuth and Stays', async () => {
  const calls: Array<RequestInit | undefined> = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });

  await tracedFetch('https://auth.travelport.net/oauth/token', {
    method: 'POST',
    cache: 'force-cache',
    credentials: 'include',
    redirect: 'follow',
    referrer: 'https://sf.example/internal',
    referrerPolicy: 'unsafe-url',
    keepalive: true,
    integrity: 'sha256-not-provider-authority',
  });
  await tracedFetch(new Request('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    cache: 'force-cache',
    credentials: 'include',
    redirect: 'follow',
    referrer: 'https://sf.example/book',
    referrerPolicy: 'unsafe-url',
    keepalive: true,
    integrity: 'sha256-not-provider-authority',
    headers: { E2ETrackingID: `sf-${TRACE_ID}` },
  }));

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call?.cache, 'no-store');
    assert.equal(call?.credentials, 'omit');
    assert.equal(call?.redirect, 'manual');
    assert.equal(call?.referrer, '');
    assert.equal(call?.referrerPolicy, 'no-referrer');
    assert.equal(call?.keepalive, false);
    assert.equal(call?.integrity, '');
  }
});

test('rejects caller-controlled routing, ambient credential, forwarding, and hop-by-hop headers before Travelport transport', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });
  const forbiddenHeaders = [
    ['Host', 'example.com'],
    ['Cookie', 'session=secret'],
    ['Content-Length', '2'],
    ['Content-Encoding', 'gzip'],
    ['Content-Range', 'bytes 0-1/2'],
    ['Expect', '100-continue'],
    ['Connection', 'keep-alive'],
    ['Proxy-Authorization', 'Basic secret'],
    ['Transfer-Encoding', 'chunked'],
    ['Forwarded', 'for=127.0.0.1'],
    ['X-Forwarded-Host', 'example.com'],
    ['If-None-Match', '"stale-etag"'],
    ['Range', 'bytes=0-99'],
    ['Origin', 'https://sf.example'],
    ['Referer', 'https://sf.example/book'],
  ] as const;

  for (const [name, value] of forbiddenHeaders) {
    await assert.rejects(
      tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
        method: 'POST',
        headers: { E2ETrackingID: `sf-${TRACE_ID}`, [name]: value },
      }),
      assertInvalidRequest,
    );
  }

  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', {
      method: 'POST',
      headers: { Cookie: 'session=secret' },
    }),
    assertInvalidRequest,
  );
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', {
      method: 'POST',
      headers: { Authorization: 'Bearer stays-token' },
    }),
    assertInvalidRequest,
  );

  assert.equal(calls, 0);
});

test('accepts only the adapter-owned OAuth form and Stays JSON body representations', async () => {
  const calls: Array<RequestInit | undefined> = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });
  const tokenBody = oauthBody();
  const staysBody = '{"SearchCriteriaHospitality":{"test":true}}';

  await tracedFetch('https://auth.travelport.net/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });
  await tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    headers: {
      E2ETrackingID: `sf-${TRACE_ID}`,
      'Content-Type': 'application/json',
    },
    body: staysBody,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.body, tokenBody);
  assert.equal(calls[1]?.body, staysBody);
});

test('rejects non-canonical OAuth and Stays request bodies before Travelport transport', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const tracedFetch = createTravelportStaysTraceFetch({ environment: 'production', fetchImpl });
  const formHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const staysHeaders = { E2ETrackingID: `sf-${TRACE_ID}`, 'Content-Type': 'application/json' };

  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', {
      method: 'POST', headers: formHeaders, body: 'grant_type=password',
    }),
    assertInvalidRequest,
  );

  const wrongGrant = oauthBody();
  wrongGrant.set('grant_type', 'client_credentials');
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', { method: 'POST', headers: formHeaders, body: wrongGrant }),
    assertInvalidRequest,
  );

  const duplicateField = oauthBody();
  duplicateField.append('username', 'second-user');
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', { method: 'POST', headers: formHeaders, body: duplicateField }),
    assertInvalidRequest,
  );

  const extraField = oauthBody();
  extraField.append('scope', 'unexpected');
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', { method: 'POST', headers: formHeaders, body: extraField }),
    assertInvalidRequest,
  );

  const oversizedCredential = oauthBody();
  oversizedCredential.set('password', 'x'.repeat(4097));
  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', { method: 'POST', headers: formHeaders, body: oversizedCredential }),
    assertInvalidRequest,
  );

  await assert.rejects(
    tracedFetch('https://auth.travelport.net/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: oauthBody(),
    }),
    assertInvalidRequest,
  );

  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST', headers: staysHeaders, body: new URLSearchParams({ test: 'true' }),
    }),
    assertInvalidRequest,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST', headers: staysHeaders, body: '[]',
    }),
    assertInvalidRequest,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST', headers: { ...staysHeaders, 'Content-Type': 'text/plain' }, body: '{}',
    }),
    assertInvalidRequest,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST', headers: staysHeaders, body: `{"payload":"${'x'.repeat(4 * 1024 * 1024)}"}`,
    }),
    assertInvalidRequest,
  );
  await assert.rejects(
    tracedFetch('https://api.travelport.net/11/hotel/book/reservations/D6VBHL', {
      method: 'GET', headers: staysHeaders, body: '{}',
    }),
    assertInvalidRequest,
  );

  const inheritedBody = new Request('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    headers: staysHeaders,
    body: '{}',
  });
  await assert.rejects(tracedFetch(inheritedBody), assertInvalidRequest);
  await assert.rejects(tracedFetch(inheritedBody, { body: null }), assertInvalidRequest);

  assert.equal(calls, 0);
});
