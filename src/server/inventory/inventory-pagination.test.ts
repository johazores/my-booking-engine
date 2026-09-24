import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeInventoryPagination, resolveInventoryPagination } from './inventory-pagination.ts';

test('normalizes invalid inventory page requests and caps page size', () => {
  assert.deepEqual(normalizeInventoryPagination({ page: -2, pageSize: 0 }), { page: 1, pageSize: 20 });
  assert.deepEqual(normalizeInventoryPagination({ page: 3, pageSize: 500 }), { page: 3, pageSize: 50 });
  assert.deepEqual(normalizeInventoryPagination({ page: 2, pageSize: 12 }), { page: 2, pageSize: 12 });
});

test('clamps out-of-range pages after the authoritative count', () => {
  assert.deepEqual(resolveInventoryPagination({ total: 0, page: 99, pageSize: 20 }), {
    page: 1,
    pageSize: 20,
    totalPages: 1,
    skip: 0,
    take: 20,
  });
  assert.deepEqual(resolveInventoryPagination({ total: 101, page: 99, pageSize: 20 }), {
    page: 6,
    pageSize: 20,
    totalPages: 6,
    skip: 100,
    take: 20,
  });
});

test('rejects impossible collection totals', () => {
  assert.throws(() => resolveInventoryPagination({ total: -1, page: 1, pageSize: 20 }), /non-negative safe integer/i);
  assert.throws(() => resolveInventoryPagination({ total: Number.MAX_SAFE_INTEGER + 1, page: 1, pageSize: 20 }), /non-negative safe integer/i);
});
