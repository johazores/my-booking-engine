import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('src/server/inventory/hospitality-image-service.ts', 'utf8');
const page = readFileSync('app/inventory/[property-id]/images/page.tsx', 'utf8');
const docs = readFileSync('docs/hospitality-image-pagination.md', 'utf8');

test('image management reads are tenant scoped, paginated and snapshot consistent', () => {
  assert.match(service, /resolveInventoryPagination/);
  assert.match(service, /export async function listHospitalityImagesPage/);
  assert.equal((service.match(/permission: 'inventory:read'/g) ?? []).length, 1);
  assert.match(service, /transaction\.hospitalityRoomTypeImage\.count\(\{ where \}\)/);
  assert.match(service, /transaction\.hospitalityPropertyImage\.count\(\{ where \}\)/);
  assert.match(service, /transaction\.hospitalityRoomTypeImage\.findMany/);
  assert.match(service, /transaction\.hospitalityPropertyImage\.findMany/);
  assert.equal((service.match(/skip: pagination\.skip/g) ?? []).length, 2);
  assert.equal((service.match(/take: pagination\.take/g) ?? []).length, 2);
  assert.equal((service.match(/isolationLevel: 'RepeatableRead'/g) ?? []).length, 2);
  assert.equal((service.match(/orderBy: \[\{ isPrimary: 'desc' \}, \{ sortOrder: 'asc' \}, \{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/g) ?? []).length, 4);
});

test('legacy complete image reads fail closed instead of silently truncating at 50', () => {
  assert.match(service, /MAX_COMPLETE_IMAGE_ROWS = 1_000/);
  assert.equal((service.match(/take: MAX_COMPLETE_IMAGE_ROWS \+ 1/g) ?? []).length, 2);
  assert.equal((service.match(/assertCompleteImageRead\(images,/g) ?? []).length, 2);
  assert.doesNotMatch(service, /IMAGE_LIMIT = 50/);
});

test('image management UI uses authoritative totals and accessible page navigation', () => {
  assert.match(page, /parseInventoryPage\(query\.imagePage\)/);
  assert.match(page, /listHospitalityImagesPage/);
  assert.match(page, /imageResult\.total/);
  assert.match(page, /imageResult\.images\.map/);
  assert.match(page, /imageResult\.totalPages > 1/);
  assert.match(page, /aria-label="Image pages"/);
  assert.doesNotMatch(page, /\blistHospitalityImages\b/);
});

test('documentation records pagination, snapshot, complete-read and tenant boundaries', () => {
  assert.match(docs, /RepeatableRead/);
  assert.match(docs, /defaults to 20/);
  assert.match(docs, /capped at 50/);
  assert.match(docs, /1,000-row safety ceiling/);
  assert.match(docs, /tenant isolation/);
});
