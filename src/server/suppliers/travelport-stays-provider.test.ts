import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  normalizeTravelportStaysConfiguration,
  probeTravelportStaysIntegrationHealth,
  requestTravelportStaysAccessToken,
  TravelportStaysConfigurationError,
  TravelportStaysProvider,
} from './travelport-stays-provider.ts';

const configuration = normalizeTravelportStaysConfiguration({
  environment: 'pre-production',
  username: 'test-user',
  password: 'test-password',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  accessGroup: 'access-group',
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('configuration derives only the implemented hotel-search capability and rejects caller-controlled environments', () => {
  assert.deepEqual(configuration.capabilities, ['hotel-search']);
  assert.equal(configuration.credentials.environment, 'pre-production');
  assert.throws(() => normalizeTravelportStaysConfiguration({
    ...configuration.credentials,
    environment: 'https://attacker.invalid/',
  }), TravelportStaysConfigurationError);
  assert.throws(() => normalizeTravelportStaysConfiguration({
    ...configuration.credentials,
    username: 'bad\nheader',
  }), TravelportStaysConfigurationError);
});

test('token request uses the fixed pre-production endpoint and documented password-grant fields without returning credentials', async () => {
  let calledUrl = '';
  let calledInit: RequestInit | undefined;
  const token = await requestTravelportStaysAccessToken({
    credentials: configuration.credentials,
    nowMs: 1_000,
    fetchImpl: (async (url, init) => {
      calledUrl = String(url);
      calledInit = init;
      return jsonResponse({ access_token: 'token-value', expires_in: 86400 });
    }) as typeof fetch,
  });

  assert.equal(calledUrl, 'https://auth.pp.travelport.net/oauth/token');
  assert.equal(calledInit?.method, 'POST');
  assert.equal(new Headers(calledInit?.headers).get('Content-Type'), 'application/x-www-form-urlencoded');
  const body = calledInit?.body as URLSearchParams;
  assert.equal(body.get('grant_type'), 'password');
  assert.equal(body.get('username'), 'test-user');
  assert.equal(body.get('password'), 'test-password');
  assert.equal(body.get('client_id'), 'client-id');
  assert.equal(body.get('client_secret'), 'client-secret');
  assert.deepEqual(Object.keys(token).sort(), ['accessToken', 'expiresAtMs']);
  assert.equal(token.accessToken, 'token-value');
  assert.ok(token.expiresAtMs > 1_000);
});

test('health probe safely classifies authentication, rate-limit, outage and malformed success responses', async () => {
  const statuses = [
    [401, 'AUTHENTICATION_FAILED', 'AUTHENTICATION_FAILED'],
    [429, 'RATE_LIMITED', 'RATE_LIMITED'],
    [503, 'PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'],
  ] as const;
  for (const [status, expectedStatus, expectedCode] of statuses) {
    const result = await probeTravelportStaysIntegrationHealth({
      credentials: configuration.credentials,
      fetchImpl: (async () => new Response('', { status })) as typeof fetch,
    });
    assert.equal(result.status, expectedStatus);
    assert.equal(result.failureCode, expectedCode);
  }

  const malformed = await probeTravelportStaysIntegrationHealth({
    credentials: configuration.credentials,
    fetchImpl: (async () => jsonResponse({ access_token: '' })) as typeof fetch,
  });
  assert.deepEqual(malformed, { status: 'INVALID_RESPONSE', failureCode: 'INVALID_RESPONSE' });
});

test('health probe classifies an aborted token request as provider timeout without leaking transport errors', async () => {
  const result = await probeTravelportStaysIntegrationHealth({
    credentials: configuration.credentials,
    timeoutMs: 1_000,
    fetchImpl: ((_, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('sensitive transport detail')), { once: true });
    })) as typeof fetch,
  });
  assert.deepEqual(result, { status: 'PROVIDER_UNAVAILABLE', failureCode: 'TIMEOUT' });
});

test('SearchComplete uses fixed Travelport endpoints/headers, bounded input and returns provider-neutral property records', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'cached-access-token', expires_in: 86400 });
    return jsonResponse({
      traceId: 'provider-trace',
      pagination: { page: 1, pageSize: 2, totalPages: 2, totalItems: 3, paginationToken: 'next-token' },
      hotelsResponse: {
        propertyItems: [
          { name: 'Hotel One', propertyCode: 'ABC12', estimatedPropertyType: 'Hotel', availability: true },
          { name: 'Hotel Two', propertyCode: 'XYZ99', availability: false },
        ],
      },
    });
  }) as typeof fetch;

  const provider = new TravelportStaysProvider({
    credentials: configuration.credentials,
    cacheKey: 'tenant-a:v1',
    fetchImpl,
  });
  const result = await provider.searchProperties({
    cityIataCode: 'syd',
    checkInDateLocal: '2026-10-10',
    checkOutDateLocal: '2026-10-12',
    rooms: 1,
    adults: 2,
    childAges: [5],
    radiusKm: 30,
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.url, 'https://api.pp.travelport.net/12/hotel/search/searchcomplete');
  const headers = new Headers(requests[1]?.init?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer cached-access-token');
  assert.equal(headers.get('XAUTH_TRAVELPORT_ACCESSGROUP'), 'access-group');
  assert.equal(headers.get('username'), 'test-user');
  assert.equal(headers.get('password'), 'test-password');
  assert.equal(headers.get('client_id'), 'client-id');
  assert.equal(headers.get('client_secret'), 'client-secret');
  assert.match(headers.get('E2ETrackingID') ?? '', /^sf-[0-9a-f-]{36}$/);
  const body = JSON.parse(String(requests[1]?.init?.body));
  assert.deepEqual(body, {
    stayDetails: {
      checkInDateLocal: '2026-10-10',
      checkOutDateLocal: '2026-10-12',
      rooms: 1,
      guests: { adults: 2, children: [{ age: 5 }] },
    },
    propertyFilter: {
      location: {
        type: 'cityIATACode',
        details: { iataCode: 'SYD' },
        radius: { value: 30, unit: 'km' },
      },
      returnOnlyAvailableProperties: true,
    },
  });
  assert.deepEqual(result, {
    properties: [
      { supplierPropertyReference: 'eyJwcm9wZXJ0eUNvZGUiOiJBQkMxMiJ9', name: 'Hotel One', propertyType: 'Hotel', available: true },
      { supplierPropertyReference: 'eyJwcm9wZXJ0eUNvZGUiOiJYWVo5OSJ9', name: 'Hotel Two', propertyType: null, available: false },
    ],
    page: 1,
    pageSize: 2,
    totalPages: 2,
    totalItems: 3,
    nextPageToken: 'next-token',
  });

  await provider.searchProperties({
    cityIataCode: 'MEL',
    checkInDateLocal: '2026-11-10',
    checkOutDateLocal: '2026-11-11',
    rooms: 1,
    adults: 1,
  });
  assert.equal(requests.filter((request) => request.url.includes('/oauth/token')).length, 1, 'token should be reused for the credential-version cache key');
});

test('SearchComplete fails closed for bad inputs and malformed or oversized provider pages', async () => {
  const provider = new TravelportStaysProvider({
    credentials: configuration.credentials,
    cacheKey: 'tenant-b:v1',
    fetchImpl: (async (url) => {
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token-value' });
      return jsonResponse({
        pagination: { page: 1, pageSize: 101, totalPages: 1, totalItems: 101 },
        hotelsResponse: { propertyItems: [] },
      });
    }) as typeof fetch,
  });

  await assert.rejects(provider.searchProperties({
    cityIataCode: 'not-a-city',
    checkInDateLocal: '2026-10-10',
    checkOutDateLocal: '2026-10-12',
    rooms: 1,
    adults: 2,
  }), (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST');

  await assert.rejects(provider.searchProperties({
    cityIataCode: 'SYD',
    checkInDateLocal: '2026-10-10',
    checkOutDateLocal: '2026-10-12',
    rooms: 1,
    adults: 2,
  }), (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE');
});

test('SearchComplete evicts an access token after provider authentication rejection so a later request can refresh credentials', async () => {
  let tokenCalls = 0;
  let searchCalls = 0;
  const provider = new TravelportStaysProvider({
    credentials: configuration.credentials,
    cacheKey: 'tenant-c:v1',
    fetchImpl: (async (url) => {
      if (String(url).includes('/oauth/token')) {
        tokenCalls += 1;
        return jsonResponse({ access_token: `token-${tokenCalls}`, expires_in: 86400 });
      }
      searchCalls += 1;
      if (searchCalls === 1) return new Response('', { status: 401 });
      return jsonResponse({
        pagination: { page: 1, pageSize: 0, totalPages: 0, totalItems: 0 },
        hotelsResponse: { propertyItems: [] },
      });
    }) as typeof fetch,
  });
  const search = {
    cityIataCode: 'SYD',
    checkInDateLocal: '2026-12-10',
    checkOutDateLocal: '2026-12-11',
    rooms: 1,
    adults: 1,
  } as const;

  await assert.rejects(provider.searchProperties(search), (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'AUTHENTICATION_FAILED');
  await provider.searchProperties(search);
  assert.equal(tokenCalls, 2);
});
