import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const service = read('src/server/availability/hospitality-availability-window-service.ts');
const integration = read('src/server/availability/hospitality-availability.integration.ts');
const docs = read('docs/hospitality-availability-window-pagination.md');

test('availability-window collection page is authorized, tenant scoped, and bounded', () => {
  assert.match(service, /export async function listHospitalityAvailabilityWindowsPage/);
  assert.match(service, /permission: 'availability:read'/);
  assert.match(service, /AVAILABILITY_WINDOW_PAGE_SIZE_DEFAULT = 20/);
  assert.match(service, /AVAILABILITY_WINDOW_PAGE_SIZE_MAX = 50/);
  assert.match(service, /const where = availabilityWindowScope\(input\)/);
  assert.match(service, /hospitalityAvailabilityWindow\.count\(\{ where \}\)/);
  assert.match(service, /skip: \(page - 1\) \* pageSize/);
  assert.match(service, /take: pageSize/);
  assert.match(service, /orderBy: \[\{ status: 'asc' \}, \{ startDate: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(service, /return \{ windows, total, page, totalPages, pageSize \}/);
});

test('legacy complete availability-window reads fail closed instead of truncating silently', () => {
  assert.match(service, /MAX_COMPLETE_AVAILABILITY_WINDOWS = 1_000/);
  assert.match(service, /take: MAX_COMPLETE_AVAILABILITY_WINDOWS \+ 1/);
  assert.match(service, /windows\.length > MAX_COMPLETE_AVAILABILITY_WINDOWS/);
  assert.match(service, /throw new AvailabilityWindowCollectionLimitError\(\)/);
  assert.match(service, /where: availabilityWindowScope\(input\)/);
});

test('shared collection scope repeats tenant and parent identity', () => {
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /propertyId: input\.propertyId/);
  assert.match(service, /roomTypeId: input\.roomTypeId/);
  assert.match(service, /assertUuidIdentifier\(input\.organizationId, 'organizationId'\)/);
  assert.match(service, /assertUuidIdentifier\(input\.actorUserId, 'actorUserId'\)/);
  assert.match(service, /assertUuidIdentifier\(input\.propertyId, 'propertyId'\)/);
  assert.match(service, /assertUuidIdentifier\(input\.roomTypeId, 'roomTypeId'\)/);
});

test('guarded database coverage exercises paginated and cross-tenant reads', () => {
  assert.match(integration, /windows\.listHospitalityAvailabilityWindowsPage/);
  assert.match(integration, /assert\.equal\(windowPage\.total, 1\)/);
  assert.match(integration, /assert\.deepEqual\(windowPage\.windows\.map\(\(window\) => window\.id\), \[capacityWindow\.id\]\)/);
  assert.match(integration, /assert\.equal\(crossTenantWindowPage\.total, 0\)/);
  assert.match(integration, /assert\.equal\(crossTenantWindowPage\.windows\.length, 0\)/);
});

test('documentation separates collection pagination from complete capacity authority', () => {
  assert.match(docs, /page size defaults to 20 and is capped at 50/);
  assert.match(docs, /fails closed above 1,000 records/);
  assert.match(docs, /must not be replaced with UI pagination or silently truncated results/);
  assert.match(docs, /commercial correctness requires complete relevant evidence/);
});
