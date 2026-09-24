import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const ratePlans = read('src/server/inventory/hospitality-rate-plan-service.ts');
const restrictions = read('src/server/inventory/hospitality-restriction-service.ts');
const rentals = read('src/server/inventory/rental-service.ts');
const docs = read('docs/inventory-collection-pagination.md');

test('hospitality rate-plan and restriction listing services use shared server pagination', () => {
  for (const source of [ratePlans, restrictions]) {
    assert.match(source, /resolveInventoryPagination/);
    assert.doesNotMatch(source, /take:\s*input\.pageSize/);
    assert.doesNotMatch(source, /skip:\s*\(page - 1\) \* input\.pageSize/);
    assert.match(source, /page:\s*pagination\.page/);
    assert.match(source, /pageSize:\s*pagination\.pageSize/);
    assert.match(source, /totalPages:\s*pagination\.totalPages/);
  }
});

test('hospitality collection queries retain tenant and parent resource scope', () => {
  assert.match(ratePlans, /organizationId:\s*input\.organizationId/);
  assert.match(ratePlans, /propertyId:\s*input\.propertyId/);
  assert.match(ratePlans, /orderBy:\s*\[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ id: 'asc' \}\]/);

  assert.match(restrictions, /organizationId:\s*input\.organizationId/);
  assert.match(restrictions, /propertyId:\s*input\.propertyId/);
  assert.match(restrictions, /ratePlanId:\s*input\.ratePlanId/);
  assert.match(restrictions, /roomTypeId:\s*input\.roomTypeId/);
  assert.match(restrictions, /orderBy:\s*\[\{ status: 'asc' \}, \{ startDate: 'asc' \}, \{ endDate: 'asc' \}, \{ id: 'asc' \}\]/);
});

test('rental management collections independently resolve and clamp pagination', () => {
  assert.match(rentals, /resolveInventoryPagination/);
  assert.match(rentals, /const unitTypePagination = resolveInventoryPagination/);
  assert.match(rentals, /const locationPagination = resolveInventoryPagination/);
  assert.match(rentals, /const unitPagination = resolveInventoryPagination/);
  assert.match(rentals, /const ratePagination = resolveInventoryPagination/);
  assert.doesNotMatch(rentals, /function pagination\(/);
  assert.doesNotMatch(rentals, /\.\.\.pagination\(input\./);
  assert.doesNotMatch(rentals, /take:\s*input\.pageSize/);
  assert.doesNotMatch(rentals, /Math\.ceil\([^\n]*input\.pageSize/);
});

test('rental count and page rows share repeatable-read observations', () => {
  const repeatableReads = rentals.match(/isolationLevel:\s*'RepeatableRead'/g) ?? [];
  assert.ok(repeatableReads.length >= 4);
  assert.match(rentals, /transaction\.rentalUnitType\.count/);
  assert.match(rentals, /transaction\.rentalLocation\.count/);
  assert.match(rentals, /transaction\.rentalUnit\.count/);
  assert.match(rentals, /transaction\.rentalRatePeriod\.count/);
  assert.match(rentals, /transaction\.rentalAvailabilityBlock\.count/);
});

test('rental collection reads remain tenant and parent scoped with deterministic ordering', () => {
  assert.match(rentals, /organizationId:\s*input\.organizationId/);
  assert.match(rentals, /locationId:\s*location\.id/);
  assert.match(rentals, /unitTypeId:\s*unitType\.id/);
  assert.match(rentals, /unitId:\s*unit\.id/);
  assert.match(rentals, /orderBy:\s*\[\{ name: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(rentals, /orderBy:\s*\[\{ startsOn: 'asc' \}, \{ id: 'asc' \}\]/);
});

test('documentation distinguishes bounded browsing from complete business evidence', () => {
  assert.match(docs, /service-level management collections/i);
  assert.match(docs, /hospitality rate plans/i);
  assert.match(docs, /hospitality restrictions/i);
  assert.match(docs, /rental/i);
  assert.match(docs, /RepeatableRead/);
  assert.match(docs, /UI\/list pagination is not a substitute for commercial evidence/);
});
