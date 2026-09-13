import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  createTravelportStaysReferenceAuthorityFetch,
  normalizeTravelportStaysConfiguration,
  requestTravelportStaysAccessToken,
  TravelportStaysConfigurationError,
  TravelportStaysProvider,
} from './travelport-stays-provider.ts';

const configurationInput = {
  environment: 'pre-production',
  username: 'test-user',
  password: 'test-password',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  accessGroup: 'access-group',
} as const;

const credentials = normalizeTravelportStaysConfiguration(configurationInput).credentials;

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function singlePropertyResponse(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    pagination: { page: 1, pageSize: 1, totalPages: 1, totalItems: 1 },
    hotelsResponse: {
      propertyItems: [{
        name: 'Hotel One',
        chainCode: 'HI',
        propertyCode: 'ABC12',
        roomTypes: [],
        ...overrides,
      }],
    },
  };
}

test('Travelport configuration rejects lone UTF-16 surrogate credentials before core normalization', () => {
  for (const field of ['username', 'password', 'clientId', 'clientSecret', 'accessGroup'] as const) {
    assert.throws(
      () => normalizeTravelportStaysConfiguration({
        ...configurationInput,
        [field]: `valid\ud800value`,
      }),
      TravelportStaysConfigurationError,
    );
  }
});

test('Travelport OAuth access tokens reject lone UTF-16 surrogate authority before cache or bearer use', async () => {
  await assert.rejects(
    requestTravelportStaysAccessToken({
      credentials,
      fetchImpl: (async () => jsonResponse({ access_token: 'token\ud800value', expires_in: 3600 })) as typeof fetch,
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('Travelport SearchComplete rejects lone-surrogate machine evidence before compatibility parsing', async () => {
  const guardedFetch = createTravelportStaysReferenceAuthorityFetch(
    (async () => jsonResponse(singlePropertyResponse({
      roomTypes: [{ rates: [{ rateKey: { value: 'rate\ud800key' } }] }],
    }))) as typeof fetch,
  );

  await assert.rejects(
    guardedFetch('https://api.pp.travelport.net/12/hotel/search/searchcomplete', { method: 'POST' }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('Travelport SearchComplete preserves well-formed non-BMP machine evidence', async () => {
  const response = jsonResponse(singlePropertyResponse({
    roomTypes: [{ rates: [{ rateKey: { value: 'rate-😀' } }] }],
  }));
  const guardedFetch = createTravelportStaysReferenceAuthorityFetch(
    (async () => response.clone()) as typeof fetch,
  );

  const result = await guardedFetch(
    'https://api.pp.travelport.net/12/hotel/search/searchcomplete',
    { method: 'POST' },
  );
  assert.equal(result.status, 200);
});

test('Travelport SearchComplete rejects present non-string machine evidence instead of treating it as absent', async () => {
  const guardedFetch = createTravelportStaysReferenceAuthorityFetch(
    (async () => jsonResponse(singlePropertyResponse({ chainCode: 42 }))) as typeof fetch,
  );

  await assert.rejects(
    guardedFetch('https://api.pp.travelport.net/12/hotel/search/searchcomplete', { method: 'POST' }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('Travelport pagination replay rejects lone-surrogate page tokens before provider I/O', async () => {
  let calls = 0;
  const provider = new TravelportStaysProvider({
    credentials,
    cacheKey: 'transport-unicode-authority:pagination',
    fetchImpl: (async () => {
      calls += 1;
      return jsonResponse({});
    }) as typeof fetch,
  });

  await assert.rejects(
    provider.searchPropertiesPage({ pageToken: 'page\ud800token', pageNumber: 2 }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
  assert.equal(calls, 0);
});
