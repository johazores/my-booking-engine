import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('src/server/inventory/hospitality-image-service.ts', 'utf8');
const page = readFileSync('app/inventory/[property-id]/images/page.tsx', 'utf8');
const route = readFileSync('app/api/inventory/images/route.ts', 'utf8');
const domain = readFileSync('src/server/inventory/hospitality-image-domain.ts', 'utf8');
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
  assert.equal((service.match(/orderBy: \[\{ isPrimary: 'desc' \}, \{ sortOrder: 'asc' \}, \{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/g) ?? []).length, 2);
});

test('image collections expose one explicit paginated read boundary', () => {
  assert.doesNotMatch(service, /export async function listHospitalityImages\(/);
  assert.doesNotMatch(service, /MAX_COMPLETE_IMAGE_ROWS/);
  assert.doesNotMatch(service, /assertCompleteImageRead/);
  assert.equal((service.match(/\.findMany\(/g) ?? []).length, 2);
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

test('documentation records pagination, snapshot, single-reader and tenant boundaries', () => {
  assert.match(docs, /RepeatableRead/);
  assert.match(docs, /defaults to 20/);
  assert.match(docs, /capped at 50/);
  assert.match(docs, /single image-collection read boundary/);
  assert.match(docs, /tenant isolation/);
});

test('same-gallery image mutations serialize primary authority and preserve a replacement on primary removal', () => {
  assert.match(service, /function hospitalityImageMutationLockKey/);
  assert.equal(service.split('pg_advisory_xact_lock').length - 1, 3);
  assert.equal(service.split('let promotedImageId: string | null = null').length - 1, 2);
  assert.equal(service.split('afterData: promotedImageId ? { promotedImageId } : {}').length - 1, 2);
});


test('image removal requires explicit server-validated REMOVE confirmation', () => {
  assert.match(domain, /assertHospitalityImageRemoveConfirmation/);
  assert.match(domain, /Type REMOVE to confirm image removal/);
  assert.match(service, /assertHospitalityImageRemoveConfirmation\(input\.confirmation\)/);
  assert.match(route, /confirmation: formField\(formData, 'confirmation'\)/);
  assert.match(page, /Type REMOVE to confirm/);
  assert.match(page, /name="confirmation"/);
});

test('image mutations preserve the current room-type and image-page navigation state', () => {
  assert.ok(route.includes("if (!/^[1-9]\\d*$/.test(value)) return;"));
  assert.match(route, /preservePage\(query, 'typePage', typePage\)/);
  assert.match(route, /preservePage\(query, 'imagePage', imagePage\)/);
  assert.ok((page.match(/name="typePage" value=\{roomTypes\.page\}/g) ?? []).length >= 3);
  assert.ok((page.match(/name="imagePage" value=\{imageResult\.page\}/g) ?? []).length >= 3);
});
