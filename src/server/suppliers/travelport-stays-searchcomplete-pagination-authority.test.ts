import assert from 'node:assert/strict';
import test from 'node:test';
import { createTravelportStaysReferenceAuthorityFetch } from './travelport-stays-provider.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

function response(pagination: Record<string, unknown>, count: number) {
  return new Response(JSON.stringify({
    pagination,
    hotelsResponse: {
      propertyItems: Array.from({ length: count }, (_, index) => ({
        chainCode: 'HI',
        propertyCode: `P${index}`,
      })),
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const initialUrl = 'https://api.pp.travelport.net/12/hotel/search/searchcomplete';
const page2Url = 'https://api.pp.travelport.net/12/hotel/search/searchcomplete/opaque%2Ftoken%2Bvalue?pageNumber=2';

function invalid(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE';
}

test('SearchComplete exact page geometry accepts 101 properties across 100 + 1', async () => {
  const first = createTravelportStaysReferenceAuthorityFetch((async () => response({
    page: 1, pageSize: 100, totalPages: 2, totalItems: 101, paginationToken: 'opaque/token+value',
  }, 100)) as typeof fetch);
  assert.equal((await first(initialUrl, { method: 'POST' })).ok, true);

  const second = createTravelportStaysReferenceAuthorityFetch((async () => response({
    page: 2, pageSize: 1, totalPages: 2, totalItems: 101, paginationToken: 'opaque/token+value',
  }, 1)) as typeof fetch);
  assert.equal((await second(page2Url, { method: 'GET' })).ok, true);
});

test('SearchComplete accepts only the canonical empty first-page geometry', async () => {
  const canonical = createTravelportStaysReferenceAuthorityFetch((async () => response({
    page: 1, pageSize: 0, totalPages: 0, totalItems: 0,
  }, 0)) as typeof fetch);
  assert.equal((await canonical(initialUrl, { method: 'POST' })).ok, true);

  for (const [url, pagination, count, method] of [
    [initialUrl, { page: 1, pageSize: 1, totalPages: 1, totalItems: 0 }, 1, 'POST'],
    [initialUrl, { page: 1, pageSize: 0, totalPages: 1, totalItems: 0 }, 0, 'POST'],
    [page2Url, { page: 2, pageSize: 0, totalPages: 2, totalItems: 0 }, 0, 'GET'],
  ] as const) {
    const guarded = createTravelportStaysReferenceAuthorityFetch(
      (async () => response(pagination, count)) as typeof fetch,
    );
    await assert.rejects(() => guarded(url, { method }), invalid);
  }
});

test('SearchComplete rejects impossible page counts, page sizes, and returned-property counts', async () => {
  for (const [pagination, count] of [
    [{ page: 1, pageSize: 2, totalPages: 2, totalItems: 3, paginationToken: 'token' }, 2],
    [{ page: 1, pageSize: 99, totalPages: 2, totalItems: 101, paginationToken: 'token' }, 99],
    [{ page: 1, pageSize: 100, totalPages: 2, totalItems: 101, paginationToken: 'token' }, 99],
    [{ page: 1, pageSize: 2, totalPages: 1, totalItems: 3 }, 2],
  ] as const) {
    const guarded = createTravelportStaysReferenceAuthorityFetch((async () => response(pagination, count)) as typeof fetch);
    await assert.rejects(() => guarded(initialUrl, { method: 'POST' }), invalid);
  }
});

test('SearchComplete successful authority responses require JSON and the complete result envelope', async () => {
  const malformedResponses = [
    new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({
      pagination: { page: 1, pageSize: 0, totalPages: 0, totalItems: 0 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({
      pagination: { page: 1, pageSize: 0, totalPages: 0, totalItems: 0 },
      hotelsResponse: {},
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ];

  for (const malformed of malformedResponses) {
    const guarded = createTravelportStaysReferenceAuthorityFetch(
      (async () => malformed.clone()) as typeof fetch,
    );
    await assert.rejects(() => guarded(initialUrl, { method: 'POST' }), invalid);
  }
});

test('SearchComplete rejects non-canonical continuation route authority before provider I/O', async () => {
  let calls = 0;
  const guarded = createTravelportStaysReferenceAuthorityFetch((async () => {
    calls += 1;
    return response({ page: 2, pageSize: 1, totalPages: 2, totalItems: 101 }, 1);
  }) as typeof fetch);

  for (const url of [
    'https://api.pp.travelport.net/12/hotel/search/searchcomplete/opaque%2ftoken?pageNumber=2',
    'https://api.pp.travelport.net/12/hotel/search/searchcomplete/token?pageNumber=%32',
    'https://api.pp.travelport.net/12/hotel/search/searchcomplete/token?pageNumber=2&',
  ]) {
    await assert.rejects(() => guarded(url, { method: 'GET' }), invalid);
  }
  assert.equal(calls, 0);
});
