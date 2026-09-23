import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const repository = read('src/server/inventory/hospitality-amenity-repository.ts');
const service = read('src/server/inventory/hospitality-amenity-service.ts');
const page = read('app/inventory/amenities/page.tsx');
const docs = read('docs/hospitality-amenity-pagination.md');

test('amenity management collection is server paginated and tenant scoped', () => {
  assert.match(repository, /INVENTORY_PAGE_SIZE_DEFAULT/);
  assert.match(repository, /INVENTORY_PAGE_SIZE_MAX/);
  assert.match(repository, /export async function listAmenitiesForOrganizationPage/);
  assert.match(repository, /const where = \{ organizationId: input\.organizationId \}/);
  assert.match(repository, /hospitalityAmenity\.count\(\{ where \}\)/);
  assert.match(repository, /skip: \(page - 1\) \* pageSize/);
  assert.match(repository, /take: pageSize/);
  assert.match(repository, /orderBy: \[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ id: 'asc' \}\]/);
});

test('amenity complete reads fail closed instead of becoming unbounded', () => {
  assert.match(repository, /MAX_COMPLETE_AMENITY_ROWS = 1_000/);
  assert.match(repository, /status: 'ACTIVE'/);
  assert.match(repository, /take: MAX_COMPLETE_AMENITY_ROWS \+ 1/);
  assert.match(repository, /MAX_AMENITY_ASSIGNMENT_ROWS = 1_000/);
  assert.equal((repository.match(/take: MAX_AMENITY_ASSIGNMENT_ROWS \+ 1/g) ?? []).length, 2);
  assert.equal((repository.match(/assertCompleteReadLimit\(assignments, MAX_AMENITY_ASSIGNMENT_ROWS/g) ?? []).length, 2);
});

test('amenity services retain server-side read authorization', () => {
  assert.match(service, /export async function listHospitalityAmenitiesPage/);
  assert.match(service, /permission: 'inventory:read'/);
  assert.match(service, /listAmenitiesForOrganizationPage\(input\)/);
  assert.match(service, /listAmenitiesForOrganization\(input\)/);
});

test('amenity management UI uses bounded page state and accessible navigation', () => {
  assert.match(page, /parseInventoryPage\(query\.page\)/);
  assert.match(page, /parseInventoryPageSize\(query\.pageSize\)/);
  assert.match(page, /listHospitalityAmenitiesPage/);
  assert.match(page, /result\.amenities\.map/);
  assert.match(page, /result\.totalPages > 1/);
  assert.match(page, /aria-label="Amenity pages"/);
  assert.doesNotMatch(page, /\blistHospitalityAmenities\b/);
});

test('documentation distinguishes paginated management from bounded complete assignment authority', () => {
  assert.match(docs, /management directory and the assignment pickers have different read requirements/);
  assert.match(docs, /capped at 50 inside the repository boundary/);
  assert.match(docs, /fails closed above 1,000 rows/);
  assert.match(docs, /must not be reused for new large collection screens/);
});
