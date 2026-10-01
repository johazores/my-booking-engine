import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

const migration = read('prisma/migrations/20261002012000-hospitality-image-primary-integrity/migration.sql');
const service = read('src/server/inventory/hospitality-image-service.ts');
const docs = read('docs/hospitality-image-primary-integrity.md');

test('image primary migration fails closed before installing database backstops', () => {
  assert.equal((migration.match(/duplicate primary rows exist/g) ?? []).length, 2);
  assert.match(migration, /GROUP BY "organizationId", "propertyId"\s+HAVING COUNT\(\*\) > 1/);
  assert.match(migration, /GROUP BY "organizationId", "propertyId", "roomTypeId"\s+HAVING COUNT\(\*\) > 1/);
});

test('property gallery primary authority is tenant and property scoped', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "hospitality_property_images_one_primary_key"[\s\S]*CASE WHEN "isPrimary" THEN "organizationId" ELSE NULL END[\s\S]*CASE WHEN "isPrimary" THEN "propertyId" ELSE NULL END/,
  );
});

test('room-type gallery primary authority is tenant, property and room-type scoped', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "hospitality_room_type_images_one_primary_key"[\s\S]*CASE WHEN "isPrimary" THEN "organizationId" ELSE NULL END[\s\S]*CASE WHEN "isPrimary" THEN "propertyId" ELSE NULL END[\s\S]*CASE WHEN "isPrimary" THEN "roomTypeId" ELSE NULL END/,
  );
});

test('application lifecycle retains serialized primary decisions and deterministic promotion', () => {
  assert.equal((service.match(/pg_advisory_xact_lock/g) ?? []).length, 3);
  assert.equal((service.match(/isolationLevel: 'Serializable'/g) ?? []).length, 3);
  assert.equal((service.match(/orderBy: \[\{ sortOrder: 'asc' \}, \{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/g) ?? []).length, 2);
  assert.match(service, /assertHospitalityImageRemoveConfirmation\(input\.confirmation\)/);
});

test('new PostgreSQL identifiers fit the physical identifier limit', () => {
  const identifiers = [...migration.matchAll(/CREATE UNIQUE INDEX "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(identifiers, [
    'hospitality_property_images_one_primary_key',
    'hospitality_room_type_images_one_primary_key',
  ]);
  for (const identifier of identifiers) {
    assert.ok(Buffer.byteLength(identifier, 'utf8') <= 63, identifier);
  }
});

test('documentation records the database and application authority split', () => {
  assert.match(docs, /independent concurrency-safe backstop/i);
  assert.match(docs, /do not establish authorization or tenant ownership/i);
  assert.match(docs, /explicitly disposable PostgreSQL database gate/i);
});
