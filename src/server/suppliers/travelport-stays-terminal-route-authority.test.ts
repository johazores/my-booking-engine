import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysOAuthCredentialContainmentFetch } from './travelport-stays-oauth-credential-containment-fetch.ts';

const credentials = Object.freeze({
  username: 'test-user',
  password: 'test-password',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  accessGroup: 'test-access-group',
});

function headers() {
  return {
    Accept: 'application/json',
    Authorization: 'Bearer test-token',
    XAUTH_TRAVELPORT_ACCESSGROUP: credentials.accessGroup,
    E2ETrackingID: 'sf-123e4567-e89b-42d3-a456-426614174000',
  };
}

function assertInvalidRequest(error: unknown) {
  return error instanceof HospitalitySupplierProviderError
    && error.code === 'INVALID_REQUEST'
    && error.retryable === false;
}

function requestInit(method: string): RequestInit {
  return {
    method,
    headers: headers(),
    ...(method === 'POST' ? { body: '{}' } : {}),
  };
}

test('terminal containment forwards only the implemented Travelport Stays operation matrix', async () => {
  const calls: string[] = [];
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl: (async (input) => {
      calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });

  const supported = [
    ['POST', 'https://api.travelport.net/12/hotel/search/searchcomplete'],
    ['GET', 'https://api.travelport.net/12/hotel/search/searchcomplete/search-token?pageNumber=2'],
    ['POST', 'https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest'],
    ['POST', 'https://api.travelport.net/11/hotel/availability/catalogofferingshospitality'],
    ['GET', 'https://api.travelport.net/11/hotel/availability/catalogofferingshospitality/availability-token?pageNumber=5'],
    ['POST', 'https://api.travelport.net/11/hotel/book/reservations/build'],
    ['POST', 'https://api.travelport.net/11/hotel/book/reservations/build?acceptPriceChangeInd=true'],
    ['POST', 'https://api.travelport.net/11/hotel/book/reservations/build?acceptGuaranteeChangeInd=true&acceptPriceChangeInd=true'],
    ['POST', 'https://api.travelport.net/11/hotel/book/reservations/'],
    ['GET', 'https://api.travelport.net/11/hotel/book/reservations/D6VBHL'],
  ] as const;

  for (const [method, target] of supported) {
    await containedFetch(target, requestInit(method));
  }

  assert.deepEqual(calls, supported.map(([, target]) => target));
});

test('terminal containment rejects unsupported same-host Hotel operations before network I/O', async () => {
  let calls = 0;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'production',
    credentials,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });

  const unsupported = [
    ['GET', 'https://api.travelport.net/12/hotel/search/searchcomplete'],
    ['POST', 'https://api.travelport.net/12/hotel/search/searchcomplete/search-token?pageNumber=2'],
    ['GET', 'https://api.travelport.net/12/hotel/search/searchcomplete/search-token?pageNumber=1'],
    ['GET', 'https://api.travelport.net/12/hotel/search/searchcomplete/search-token?pageNumber=2&pageNumber=3'],
    ['GET', 'https://api.travelport.net/11/hotel/availability/catalogofferingshospitality/availability-token?pageNumber=2&debug=true'],
    ['GET', 'https://api.travelport.net/11/hotel/availability/catalogofferingshospitality/a/b?pageNumber=2'],
    ['GET', 'https://api.travelport.net/11/hotel/book/reservations/'],
    ['POST', 'https://api.travelport.net/11/hotel/book/reservations/D6VBHL'],
    ['DELETE', 'https://api.travelport.net/11/hotel/book/reservations/D6VBHL'],
    ['GET', 'https://api.travelport.net/11/hotel/book/reservations/D6VBHL/history'],
    ['POST', 'https://api.travelport.net/11/hotel/book/reservations/build?acceptPriceChangeInd=false'],
    ['POST', 'https://api.travelport.net/11/hotel/book/reservations/build?other=true'],
    ['POST', 'https://api.travelport.net/11/hotel/book/reservations/build?acceptPriceChangeInd=%74rue'],
    ['POST', 'https://api.travelport.net/11/hotel/cancel/reservations/D6VBHL'],
  ] as const;

  for (const [method, target] of unsupported) {
    await assert.rejects(containedFetch(target, requestInit(method)), assertInvalidRequest);
  }

  assert.equal(calls, 0);
});

test('terminal route authority applies identically in pre-production', async () => {
  let calls = 0;
  const containedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: 'pre-production',
    credentials,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });

  await containedFetch(
    'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/token?pageNumber=3',
    requestInit('GET'),
  );
  await assert.rejects(
    containedFetch('https://api.pp.travelport.net/11/hotel/book/reservations/D6VBHL/cancel', requestInit('POST')),
    assertInvalidRequest,
  );
  assert.equal(calls, 1);
});
