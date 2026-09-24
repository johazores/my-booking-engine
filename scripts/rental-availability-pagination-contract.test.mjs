import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const availability = read('src/server/inventory/rental-availability-service.ts');
const availabilityDomain = read('src/server/inventory/rental-availability-domain.ts');
const holds = read('src/server/inventory/rental-hold-service.ts');
const pagination = read('src/server/inventory/inventory-pagination.ts');
const docs = read('docs/rental-availability-pagination.md');

test('rental availability resolves the scoped count before reading a clamped page', () => {
  assert.match(availability, /resolveInventoryPagination/);
  assert.match(availability, /const \[total, ratePeriods\] = await Promise\.all/);
  assert.match(availability, /const pagination = resolveInventoryPagination\(\{\s*total,\s*page: search\.page,\s*pageSize: search\.pageSize,/s);
  assert.match(availability, /skip: pagination\.skip/);
  assert.match(availability, /take: pagination\.take/);
  assert.match(availability, /page: pagination\.page/);
  assert.match(availability, /pageSize: pagination\.pageSize/);
  assert.match(availability, /totalPages: pagination\.totalPages/);
  assert.match(availability, /isolationLevel: 'Serializable'/);
  assert.doesNotMatch(availability, /skip: \(search\.page - 1\) \* search\.pageSize/);
});

test('availability returns canonical resolved search pagination to the UI', () => {
  assert.match(availability, /const resolvedSearch = Object\.freeze\(\{\s*\.\.\.search,\s*page: pagination\.page,\s*pageSize: pagination\.pageSize,/s);
  assert.match(availability, /search: resolvedSearch/);
});

test('effective hold directory uses shared clamped inventory pagination in one snapshot', () => {
  assert.match(holds, /resolveInventoryPagination/);
  assert.match(holds, /status: 'ACTIVE' as const/);
  assert.match(holds, /expiresAt: \{ gt: now \}/);
  assert.match(holds, /const total = await transaction\.rentalAvailabilityHold\.count\(\{ where \}\)/);
  assert.match(holds, /const pagination = resolveInventoryPagination\(\{\s*total,\s*page: input\.page,\s*pageSize: input\.pageSize,/s);
  assert.match(holds, /orderBy: \[\{ expiresAt: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(holds, /skip: pagination\.skip/);
  assert.match(holds, /take: pagination\.take/);
  assert.match(holds, /isolationLevel: 'RepeatableRead'/);
  assert.doesNotMatch(holds, /normalizePage\(input\.page/);
  assert.doesNotMatch(holds, /Math\.ceil\(total \/ pageSize\)/);
});

test('availability input uses the shared inventory page-size ceiling', () => {
  assert.match(availabilityDomain, /INVENTORY_PAGE_SIZE_DEFAULT/);
  assert.match(availabilityDomain, /INVENTORY_PAGE_SIZE_MAX/);
  assert.match(availabilityDomain, /normalizePositiveInteger\(\s*input\.pageSize,\s*INVENTORY_PAGE_SIZE_DEFAULT,\s*'Page size',\s*INVENTORY_PAGE_SIZE_MAX,/s);
  assert.doesNotMatch(availabilityDomain, /MAX_PAGE_SIZE = 100/);
});

test('shared inventory pagination owns the default, maximum, clamping, and offset math', () => {
  assert.match(pagination, /INVENTORY_PAGE_SIZE_DEFAULT = 20/);
  assert.match(pagination, /INVENTORY_PAGE_SIZE_MAX = 50/);
  assert.match(pagination, /const page = Math\.min\(normalized\.page, totalPages\)/);
  assert.match(pagination, /skip: \(page - 1\) \* normalized\.pageSize/);
  assert.match(pagination, /take: normalized\.pageSize/);
});

test('documentation keeps pagination separate from commercial authority', () => {
  assert.match(docs, /presentation\/read-model collections/);
  assert.match(docs, /maximum of 50 rows/);
  assert.match(docs, /Pagination is presentation state only/);
  assert.match(docs, /commercial authority/);
});
