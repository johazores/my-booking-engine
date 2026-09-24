import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const pagination = read('src/server/inventory/inventory-pagination.ts');
const hospitality = read('src/server/inventory/hospitality-repository.ts');
const amenities = read('src/server/inventory/hospitality-amenity-repository.ts');
const tours = read('src/server/inventory/tour-repository.ts');
const appointments = read('src/server/inventory/appointment-repository.ts');
const docs = read('docs/inventory-collection-pagination.md');

const repositoryFiles = [hospitality, amenities, tours, appointments];

test('shared inventory pagination defaults and caps page size server-side', () => {
  assert.match(pagination, /INVENTORY_PAGE_SIZE_DEFAULT/);
  assert.match(pagination, /INVENTORY_PAGE_SIZE_MAX/);
  assert.match(pagination, /Number\.isSafeInteger\(input\.page\)/);
  assert.match(pagination, /Math\.min\(input\.pageSize as number, INVENTORY_PAGE_SIZE_MAX\)/);
  assert.match(pagination, /Math\.max\(1, Math\.ceil\(input\.total \/ normalized\.pageSize\)\)/);
  assert.match(pagination, /const page = Math\.min\(normalized\.page, totalPages\)/);
  assert.match(pagination, /skip: \(page - 1\) \* normalized\.pageSize/);
});

test('repository-level inventory pages use only resolved skip and take values', () => {
  for (const source of repositoryFiles) {
    assert.match(source, /resolveInventoryPagination/);
    assert.doesNotMatch(source, /skip: \([^\n]*input\.(?:page|pageSize)/);
    assert.doesNotMatch(source, /take: input\.pageSize/);
    assert.match(source, /pageSize: pagination\.pageSize/);
  }
});

test('hospitality, tour, and appointment collection scopes retain stable ordering', () => {
  assert.match(hospitality, /orderBy: \[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(hospitality, /orderBy: \[\{ status: 'asc' \}, \{ code: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(tours, /orderBy: \[\{ status: 'asc' \}, \{ startsAt: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(appointments, /orderBy: \[\{ status: 'asc' \}, \{ dayOfWeek: 'asc' \}, \{ startsAtMinute: 'asc' \}, \{ id: 'asc' \}\]/);
});

test('tenant and parent scope remains in each repository query family', () => {
  assert.match(hospitality, /organizationId: input\.organizationId/);
  assert.match(hospitality, /propertyId: input\.propertyId/);
  assert.match(hospitality, /roomTypeId: input\.roomTypeId/);
  assert.match(tours, /organizationId: input\.organizationId/);
  assert.match(tours, /tourProductId: input\.tourProductId/);
  assert.match(appointments, /organizationId: input\.organizationId/);
  assert.match(appointments, /staffId: input\.staffId/);
  assert.match(amenities, /organizationId: input\.organizationId/);
});

test('documentation keeps listing pagination separate from complete commercial evidence', () => {
  assert.match(docs, /page size defaults to `20`/);
  assert.match(docs, /page size is capped at `50`/);
  assert.match(docs, /out-of-range pages clamp to the final page/);
  assert.match(docs, /UI\/list pagination is not a substitute for commercial evidence/);
  assert.match(docs, /Additional service-level and future collection boundaries remain subject to the platform-wide pagination invariant/);
});
