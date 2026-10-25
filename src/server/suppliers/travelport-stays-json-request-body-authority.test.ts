import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { isValidTravelportStaysJsonObjectBody } from './travelport-stays-json-request-body-authority.ts';
import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';
import { createTravelportStaysOAuthCredentialContainmentFetch } from './travelport-stays-oauth-credential-containment-fetch.ts';
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
const url = 'https://api.travelport.net/11/hotel/book/reservations/build';

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

function invalidRequest(error: unknown) {
  assert.ok(error instanceof HospitalitySupplierProviderError);
  assert.equal(error.code, 'INVALID_REQUEST');
  assert.equal(error.retryable, false);
  return true;
}

const malformedBodies = [
  '{"broken":}',
  '{"valid":true} trailing',
  '{"items":[1,]}',
  '{"value":"unterminated}',
];

test('Stays JSON body syntax guard accepts object JSON and rejects malformed or non-object roots', () => {
  for (const body of ['{}', '  {"items":[{"rate":2}]}  ', '{"text":"valid 😀"}']) {
    assert.equal(isValidTravelportStaysJsonObjectBody(body), true);
  }
  for (const body of [...malformedBodies, '[]', 'null', '"string"', '{"text":"\ud800"}']) {
    assert.equal(isValidTravelportStaysJsonObjectBody(body), false);
  }
});

test('shared and terminal credentialed transports reject malformed object envelopes before I/O', async () => {
  let calls = 0;
  const terminal = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const transports = [
    createTravelportStaysTraceFetch({ environment: 'production', credentials, fetchImpl: terminal }),
    createTravelportStaysOAuthCredentialContainmentFetch({ environment: 'production', credentials, fetchImpl: terminal }),
  ];
  for (const transport of transports) {
    for (const body of malformedBodies) {
      await assert.rejects(transport(url, { method: 'POST', headers: headers(), body }), invalidRequest);
    }
  }
  assert.equal(calls, 0);
  for (const transport of transports) {
    await assert.doesNotReject(transport(url, {
      method: 'POST', headers: headers(), body: '{"valid":{"nested":[1,true]}}',
    }));
  }
  assert.equal(calls, 2);
});

test('no-network supplier-write preflight rejects malformed JSON before a durable marker', async () => {
  for (const body of malformedBodies) {
    await assert.rejects(assertTravelportStaysTransportRequestReady({
      credentials, requestInput: url,
      init: { method: 'POST', headers: headers(), body },
    }), invalidRequest);
  }
  await assert.doesNotReject(assertTravelportStaysTransportRequestReady({
    credentials, requestInput: url,
    init: { method: 'POST', headers: headers(), body: '{"valid":true}' },
  }));
});
