import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  normalizeTravelportStaysConfiguration,
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

test('SearchComplete pagination uses the documented GET endpoint, reuses authentication and sends no request body', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const provider = new TravelportStaysProvider({
    credentials: configuration.credentials,
    cacheKey: 'pagination-tenant:v1',
    fetchImpl: (async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'cached-access-token', expires_in: 86400 });
      if (String(url).endsWith('/search/searchcomplete')) {
        return jsonResponse({
          pagination: { page: 1, pageSize: 1, totalPages: 2, totalItems: 2, paginationToken: 'opaque/token+value' },
          hotelsResponse: { propertyItems: [{ name: 'Hotel One', propertyCode: 'A1', availability: true }] },
        });
      }
      return jsonResponse({
        pagination: { page: 2, pageSize: 1, totalPages: 2, totalItems: 2, paginationToken: 'opaque/token+value' },
        hotelsResponse: { propertyItems: [{ name: 'Hotel Two', propertyCode: 'A2', availability: true }] },
      });
    }) as typeof fetch,
  });

  const first = await provider.searchProperties({
    cityIataCode: 'SYD',
    checkInDateLocal: '2026-10-10',
    checkOutDateLocal: '2026-10-12',
    rooms: 1,
    adults: 2,
  });
  const second = await provider.searchPropertiesPage({ pageToken: first.nextPageToken ?? '', pageNumber: 2 });

  assert.equal(requests.length, 3);
  assert.equal(
    requests[2]?.url,
    'https://api.pp.travelport.net/12/hotel/search/searchcomplete/opaque%2Ftoken%2Bvalue?pageNumber=2',
  );
  assert.equal(requests[2]?.init?.method, 'GET');
  assert.equal(requests[2]?.init?.body, undefined);
  assert.equal(new Headers(requests[2]?.init?.headers).get('Authorization'), 'Bearer cached-access-token');
  assert.equal(requests.filter((request) => request.url.includes('/oauth/token')).length, 1);
  assert.equal(second.page, 2);
  assert.equal(second.properties[0]?.name, 'Hotel Two');
});

test('SearchComplete pagination rejects unsafe tokens, unsupported page numbers and mismatched response pages', async () => {
  const provider = new TravelportStaysProvider({
    credentials: configuration.credentials,
    cacheKey: 'pagination-tenant:v2',
    fetchImpl: (async (url) => {
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token-value' });
      return jsonResponse({
        pagination: { page: 3, pageSize: 0, totalPages: 3, totalItems: 1, paginationToken: 'token' },
        hotelsResponse: { propertyItems: [] },
      });
    }) as typeof fetch,
  });

  for (const request of [
    { pageToken: '', pageNumber: 2 },
    { pageToken: 'bad\nheader', pageNumber: 2 },
    { pageToken: 'token', pageNumber: 1 },
    { pageToken: 'token', pageNumber: 6 },
  ]) {
    await assert.rejects(
      provider.searchPropertiesPage(request),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
    );
  }

  await assert.rejects(
    provider.searchPropertiesPage({ pageToken: 'token', pageNumber: 2 }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});
