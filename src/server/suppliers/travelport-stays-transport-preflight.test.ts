import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { assertTravelportStaysTransportRequestReady } from './travelport-stays-transport-preflight.ts';
import type { TravelportStaysCredentials } from './travelport-stays-provider.ts';

const TRACE_ID = '123e4567-e89b-42d3-a456-426614174000';
const credentials: TravelportStaysCredentials = Object.freeze({
  environment: 'production',
  username: 'test-user',
  password: 'test-password',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  accessGroup: 'test-access-group',
});

function writeHeaders(overrides: Readonly<Record<string, string>> = {}) {
  return {
    'Accept-Encoding': 'gzip, deflate',
    'Cache-Control': 'no-cache',
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token',
    XAUTH_TRAVELPORT_ACCESSGROUP: credentials.accessGroup,
    E2ETrackingID: `sf-${TRACE_ID}`,
    username: credentials.username,
    password: credentials.password,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    ...overrides,
  };
}

function assertInvalidRequest(error: unknown) {
  assert.ok(error instanceof HospitalitySupplierProviderError);
  assert.equal(error.code, 'INVALID_REQUEST');
  assert.equal(error.retryable, false);
  return true;
}

test('preflights every implemented Travelport reservation write shape without provider I/O', async () => {
  for (const requestInput of [
    'https://api.travelport.net/11/hotel/book/reservations/build',
    'https://api.travelport.net/11/hotel/book/reservations/build?acceptPriceChangeInd=true',
    'https://api.travelport.net/11/hotel/book/reservations/build?acceptGuaranteeChangeInd=true',
    'https://api.travelport.net/11/hotel/book/reservations/build?acceptPriceChangeInd=true&acceptGuaranteeChangeInd=true',
    'https://api.travelport.net/11/hotel/book/reservations/',
  ]) {
    await assert.doesNotReject(assertTravelportStaysTransportRequestReady({
      credentials,
      requestInput,
      init: {
        method: 'POST',
        headers: writeHeaders(),
        body: '{}',
      },
    }));
  }
});

test('preflight fails closed on write target, credential, query, and body-policy defects', async () => {
  const invalidRequests = [
    {
      requestInput: 'https://api.pp.travelport.net/11/hotel/book/reservations/build',
      init: { method: 'POST', headers: writeHeaders(), body: '{}' },
    },
    {
      requestInput: 'https://api.travelport.net/11/hotel/book/reservations/build?acceptPriceChangeInd=false',
      init: { method: 'POST', headers: writeHeaders(), body: '{}' },
    },
    {
      requestInput: 'https://api.travelport.net/11/hotel/book/reservations/build',
      init: { method: 'POST', headers: writeHeaders({ XAUTH_TRAVELPORT_ACCESSGROUP: 'other-access-group' }), body: '{}' },
    },
    {
      requestInput: 'https://api.travelport.net/11/hotel/book/reservations/',
      init: { method: 'POST', headers: writeHeaders(), body: '[]' },
    },
  ] satisfies ReadonlyArray<Readonly<{ requestInput: string; init: RequestInit }>>;

  for (const invalid of invalidRequests) {
    await assert.rejects(assertTravelportStaysTransportRequestReady({
      credentials,
      requestInput: invalid.requestInput,
      init: invalid.init,
    }), assertInvalidRequest);
  }
});
