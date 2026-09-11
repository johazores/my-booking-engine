import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  createTravelportStaysReferenceAuthorityFetch,
  normalizeTravelportStaysConfiguration,
  probeTravelportStaysIntegrationHealth,
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

function searchResponse(pagination: Readonly<Record<string, unknown>>) {
  return {
    pagination,
    hotelsResponse: { propertyItems: [] },
  };
}

test('Travelport credentials remain exact instead of being silently trimmed or control-normalized', () => {
  for (const field of ['username', 'password', 'clientId', 'clientSecret', 'accessGroup'] as const) {
    for (const value of [' padded', 'padded ', 'bad\tvalue', 'bad\u0000value', 'bad\u007fvalue']) {
      assert.throws(
        () => normalizeTravelportStaysConfiguration({ ...configurationInput, [field]: value }),
        TravelportStaysConfigurationError,
      );
    }
  }
});

test('Travelport OAuth access tokens reject padding and the full ASCII control range before use', async () => {
  for (const accessToken of [' token', 'token ', 'to\tken', 'to\u0000ken', 'to\u001fken', 'to\u007fken']) {
    await assert.rejects(
      requestTravelportStaysAccessToken({
        credentials,
        fetchImpl: (async () => jsonResponse({ access_token: accessToken, expires_in: 3600 })) as typeof fetch,
      }),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('Travelport health probe does not report healthy for normalization-confusable OAuth authority', async () => {
  const result = await probeTravelportStaysIntegrationHealth({
    credentials,
    fetchImpl: (async () => jsonResponse({ access_token: 'token\tvalue', expires_in: 3600 })) as typeof fetch,
  });
  assert.deepEqual(result, { status: 'INVALID_RESPONSE', failureCode: 'INVALID_RESPONSE' });
});

test('SearchComplete rejects normalization-confusable pagination tokens before compatibility parsing', async () => {
  for (const pageToken of [' next-token', 'next-token ', 'next\ttoken', 'next\u0000token', 'next\u007ftoken']) {
    const provider = new TravelportStaysProvider({
      credentials,
      cacheKey: `transport-authority:response:${Buffer.from(pageToken).toString('hex')}`,
      fetchImpl: (async (url) => String(url).includes('/oauth/token')
        ? jsonResponse({ access_token: 'token' })
        : jsonResponse(searchResponse({
          page: 1,
          pageSize: 100,
          totalPages: 2,
          totalItems: 101,
          paginationToken: pageToken,
        }))) as typeof fetch,
    });

    await assert.rejects(
      provider.searchProperties({
        cityIataCode: 'SYD',
        checkInDateLocal: '2026-10-10',
        checkOutDateLocal: '2026-10-12',
        rooms: 1,
        adults: 2,
      }),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('SearchComplete rejects pagination metadata outside the documented page range and bounded collection shape', async () => {
  for (const pagination of [
    { page: 0, pageSize: 0, totalPages: 0, totalItems: 0 },
    { page: 1, pageSize: 100, totalPages: 6, totalItems: 500, paginationToken: 'next-token' },
    { page: 1, pageSize: 100, totalPages: 5, totalItems: 501, paginationToken: 'next-token' },
    { page: 6, pageSize: 100, totalPages: 5, totalItems: 500, paginationToken: 'next-token' },
    { page: 1, pageSize: 101, totalPages: 5, totalItems: 500, paginationToken: 'next-token' },
    { page: 1, pageSize: 0, totalPages: 1, totalItems: 1 },
    { page: 1, pageSize: 1, totalPages: 0, totalItems: 1 },
    { page: 2, pageSize: 1, totalPages: 1, totalItems: 1 },
    { page: 1, pageSize: 100, totalPages: 1, totalItems: 101 },
    { page: 2, pageSize: 100, totalPages: 2, totalItems: 201, paginationToken: 'next-token' },
  ]) {
    const provider = new TravelportStaysProvider({
      credentials,
      cacheKey: `transport-authority:metadata:${JSON.stringify(pagination)}`,
      fetchImpl: (async (url) => String(url).includes('/oauth/token')
        ? jsonResponse({ access_token: 'token' })
        : jsonResponse(searchResponse(pagination))) as typeof fetch,
    });

    await assert.rejects(
      provider.searchProperties({
        cityIataCode: 'SYD',
        checkInDateLocal: '2026-10-10',
        checkOutDateLocal: '2026-10-12',
        rooms: 1,
        adults: 2,
      }),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('SearchComplete binds first-page identity and continuation-token presence to the initial request', async () => {
  for (const pagination of [
    { page: 2, pageSize: 100, totalPages: 2, totalItems: 101, paginationToken: 'next-token' },
    { page: 1, pageSize: 100, totalPages: 2, totalItems: 101 },
    { page: 1, pageSize: 1, totalPages: 1, totalItems: 1, paginationToken: 'unexpected-token' },
  ]) {
    const provider = new TravelportStaysProvider({
      credentials,
      cacheKey: `transport-authority:first-page:${JSON.stringify(pagination)}`,
      fetchImpl: (async (url) => String(url).includes('/oauth/token')
        ? jsonResponse({ access_token: 'token' })
        : jsonResponse(searchResponse(pagination))) as typeof fetch,
    });

    await assert.rejects(
      provider.searchProperties({
        cityIataCode: 'SYD',
        checkInDateLocal: '2026-10-10',
        checkOutDateLocal: '2026-10-12',
        rooms: 1,
        adults: 2,
      }),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('SearchComplete binds initial and continuation HTTP methods to the documented routes', async () => {
  const guardedFetch = createTravelportStaysReferenceAuthorityFetch(
    (async () => jsonResponse(searchResponse({
      page: 1,
      pageSize: 0,
      totalPages: 0,
      totalItems: 0,
    }))) as typeof fetch,
  );

  for (const [url, method] of [
    ['https://api.pp.travelport.net/12/hotel/search/searchcomplete', 'GET'],
    ['https://api.pp.travelport.net/12/hotel/search/searchcomplete?pageNumber=2', 'POST'],
    ['https://api.pp.travelport.net/12/hotel/search/searchcomplete/token?pageNumber=2', 'POST'],
  ] as const) {
    await assert.rejects(
      guardedFetch(url, { method }),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('SearchComplete preserves the existing empty first-page compatibility shape', async () => {
  const provider = new TravelportStaysProvider({
    credentials,
    cacheKey: 'transport-authority:empty-first-page',
    fetchImpl: (async (url) => String(url).includes('/oauth/token')
      ? jsonResponse({ access_token: 'token' })
      : jsonResponse(searchResponse({
        page: 1,
        pageSize: 0,
        totalPages: 0,
        totalItems: 0,
      }))) as typeof fetch,
  });

  const result = await provider.searchProperties({
    cityIataCode: 'SYD',
    checkInDateLocal: '2026-10-10',
    checkOutDateLocal: '2026-10-12',
    rooms: 1,
    adults: 2,
  });
  assert.deepEqual(result, {
    properties: [],
    page: 1,
    pageSize: 0,
    totalPages: 0,
    totalItems: 0,
    nextPageToken: null,
  });
});

test('pagination replay rejects padded and controlled identifiers before any provider request', async () => {
  for (const pageToken of [' page-token', 'page-token ', 'page\ttoken', 'page\u0000token', 'page\u007ftoken']) {
    let calls = 0;
    const provider = new TravelportStaysProvider({
      credentials,
      cacheKey: `transport-authority:request:${Buffer.from(pageToken).toString('hex')}`,
      fetchImpl: (async () => {
        calls += 1;
        return jsonResponse({});
      }) as typeof fetch,
    });

    await assert.rejects(
      provider.searchPropertiesPage({ pageToken, pageNumber: 2 }),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
    );
    assert.equal(calls, 0);
  }
});
