import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalitySupplierProviderError,
  type HospitalitySupplierProvider,
  type HospitalitySupplierSearchPageInput,
  type HospitalitySupplierSearchResult,
} from './hospitality-supplier-provider.ts';
import { collectHospitalitySupplierPropertySearch } from './hospitality-supplier-search.ts';

const search = {
  cityIataCode: 'SYD',
  checkInDateLocal: '2026-10-10',
  checkOutDateLocal: '2026-10-12',
  rooms: 1,
  adults: 2,
} as const;

function page(input: {
  page: number;
  totalPages: number;
  totalItems: number;
  refs: readonly string[];
  token?: string | null;
}): HospitalitySupplierSearchResult {
  return Object.freeze({
    properties: Object.freeze(input.refs.map((supplierPropertyReference) => Object.freeze({
      supplierPropertyReference,
      name: `Hotel ${supplierPropertyReference}`,
      propertyType: 'Hotel',
      available: true,
    }))),
    page: input.page,
    pageSize: input.refs.length,
    totalPages: input.totalPages,
    totalItems: input.totalItems,
    nextPageToken: input.token ?? null,
  });
}

function provider(input: {
  first: HospitalitySupplierSearchResult;
  continuation?: Readonly<Record<number, HospitalitySupplierSearchResult>>;
}) {
  const requestedPages: HospitalitySupplierSearchPageInput[] = [];
  const value: HospitalitySupplierProvider = {
    code: 'test-supplier',
    async searchProperties() {
      return input.first;
    },
    async searchPropertiesPage(request) {
      requestedPages.push(request);
      const result = input.continuation?.[request.pageNumber];
      if (!result) throw new Error('Unexpected continuation page.');
      return result;
    },
  };
  return { value, requestedPages };
}

test('complete supplier search consumes every bounded page without exposing the page token', async () => {
  const fixture = provider({
    first: page({ page: 1, totalPages: 3, totalItems: 5, refs: ['a', 'b'], token: 'opaque-search-token' }),
    continuation: {
      2: page({ page: 2, totalPages: 3, totalItems: 5, refs: ['c', 'd'], token: 'opaque-search-token' }),
      3: page({ page: 3, totalPages: 3, totalItems: 5, refs: ['e'], token: 'opaque-search-token' }),
    },
  });

  const result = await collectHospitalitySupplierPropertySearch(fixture.value, search);
  assert.deepEqual(fixture.requestedPages, [
    { pageToken: 'opaque-search-token', pageNumber: 2 },
    { pageToken: 'opaque-search-token', pageNumber: 3 },
  ]);
  assert.deepEqual(result, {
    providerCode: 'test-supplier',
    properties: [
      { supplierPropertyReference: 'a', name: 'Hotel a', propertyType: 'Hotel', available: true },
      { supplierPropertyReference: 'b', name: 'Hotel b', propertyType: 'Hotel', available: true },
      { supplierPropertyReference: 'c', name: 'Hotel c', propertyType: 'Hotel', available: true },
      { supplierPropertyReference: 'd', name: 'Hotel d', propertyType: 'Hotel', available: true },
      { supplierPropertyReference: 'e', name: 'Hotel e', propertyType: 'Hotel', available: true },
    ],
    totalItems: 5,
    pagesFetched: 3,
  });
  assert.equal('nextPageToken' in result, false);
});

test('complete supplier search supports a zero-result first page without pagination calls', async () => {
  const fixture = provider({ first: page({ page: 1, totalPages: 0, totalItems: 0, refs: [] }) });
  const result = await collectHospitalitySupplierPropertySearch(fixture.value, search);
  assert.equal(result.totalItems, 0);
  assert.equal(result.pagesFetched, 1);
  assert.deepEqual(fixture.requestedPages, []);
});

test('complete supplier search fails closed for missing pagination authority, unsupported page counts and inconsistent pages', async () => {
  const cases = [
    provider({ first: page({ page: 1, totalPages: 2, totalItems: 2, refs: ['a'] }) }),
    provider({ first: page({ page: 1, totalPages: 6, totalItems: 6, refs: ['a'], token: 'token' }) }),
    provider({
      first: page({ page: 1, totalPages: 2, totalItems: 2, refs: ['a'], token: 'token' }),
      continuation: { 2: page({ page: 3, totalPages: 2, totalItems: 2, refs: ['b'] }) },
    }),
    provider({
      first: page({ page: 1, totalPages: 2, totalItems: 2, refs: ['a'], token: 'token' }),
      continuation: { 2: page({ page: 2, totalPages: 2, totalItems: 3, refs: ['b'] }) },
    }),
    provider({
      first: page({ page: 1, totalPages: 2, totalItems: 2, refs: ['a'], token: 'token' }),
      continuation: { 2: page({ page: 2, totalPages: 2, totalItems: 2, refs: ['a'] }) },
    }),
  ];

  for (const fixture of cases) {
    await assert.rejects(
      collectHospitalitySupplierPropertySearch(fixture.value, search),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});
