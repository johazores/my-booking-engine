import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const byteLength = (name) => Buffer.byteLength(name, 'utf8');
const storedName = (name) => Buffer.from(name, 'utf8').subarray(0, 63).toString('utf8');

const foundations = [
  read('prisma/migrations/20260831092000_hospitality-amenities/migration.sql'),
  read('prisma/migrations/20260831094500_hospitality-images/migration.sql'),
  read('prisma/migrations/20260831103000_hospitality-rate-plans/migration.sql'),
  read('prisma/migrations/20260831113000_hospitality-restrictions/migration.sql'),
  read('prisma/migrations/20260831094500_hospitality-availability-windows/migration.sql'),
].join('\n');
const portabilityMigration = read('prisma/migrations/20260922122500-hospitality-inventory-identifier-portability/migration.sql');
const schema = read('prisma/schema.prisma');

const renames = [
  ['hospitality_room_type_amenities_roomTypeId_propertyId_organizationId_fkey', 'hospitality_room_type_amenities_room_type_fkey'],
  ['hospitality_property_images_organizationId_propertyId_isPrimary_sortOrder_idx', 'hospitality_property_images_scope_sort_idx'],
  ['hospitality_room_type_images_organizationId_propertyId_roomTypeId_isPrimary_sortOrder_idx', 'hospitality_room_type_images_scope_sort_idx'],
  ['hospitality_room_type_images_roomTypeId_propertyId_organizationId_fkey', 'hospitality_room_type_images_room_type_fkey'],
  ['hospitality_room_type_rate_plans_roomTypeId_propertyId_organizationId_fkey', 'hospitality_room_type_rate_plans_room_type_fkey'],
  ['hospitality_room_type_rate_plans_ratePlanId_propertyId_organizationId_fkey', 'hospitality_room_type_rate_plans_rate_plan_fkey'],
  ['hospitality_restrictions_ratePlanId_propertyId_organizationId_fkey', 'hospitality_restrictions_rate_plan_fkey'],
  ['hospitality_restrictions_roomTypeId_propertyId_organizationId_fkey', 'hospitality_restrictions_room_type_fkey'],
  ['hospitality_restrictions_organizationId_propertyId_ratePlanId_status_startDate_idx', 'hospitality_restrictions_rate_plan_dates_idx'],
  ['hospitality_restrictions_organizationId_propertyId_roomTypeId_status_startDate_idx', 'hospitality_restrictions_room_type_dates_idx'],
  ['hospitality_availability_windows_id_propertyId_organizationId_key', 'hospitality_availability_windows_id_property_org_key'],
  ['hospitality_availability_windows_organizationId_propertyId_roomTypeId_status_startDate_idx', 'hospitality_availability_windows_scope_start_idx'],
  ['hospitality_availability_windows_roomTypeId_propertyId_organizationId_fkey', 'hospitality_availability_windows_room_type_fkey'],
];

test('focused hospitality inventory foundations contain exactly the known overlong identifiers', () => {
  const names = [...foundations.matchAll(/(?:CONSTRAINT|INDEX)\s+"([^"]+)"/g)].map((match) => match[1]);
  const overlong = names.filter((name) => byteLength(name) > 63).sort();
  const expected = renames.map(([legacy]) => legacy).sort();

  assert.deepEqual(overlong, expected);
  assert.equal(new Set(expected.map(storedName)).size, expected.length);
  for (const name of expected) assert.equal(byteLength(storedName(name)), 63);
});

test('portability migration renames exact stored names to compact unique names without rebuilding data', () => {
  for (const [legacy, finalName] of renames) {
    assert.match(portabilityMigration, new RegExp(`"${storedName(legacy)}"[\\s\\S]*?"${finalName}"`));
    assert.ok(byteLength(finalName) <= 63, `${finalName} exceeds PostgreSQL identifier limit`);
  }

  assert.equal(new Set(renames.map(([, finalName]) => finalName)).size, renames.length);
  assert.doesNotMatch(portabilityMigration, /\b(?:CREATE|DROP|INSERT|UPDATE|DELETE)\b/i);
});

test('Prisma maps every compact hospitality inventory physical name', () => {
  for (const [legacy, finalName] of renames) {
    assert.doesNotMatch(schema, new RegExp(`map:\\s*"${legacy}"`));
    assert.match(schema, new RegExp(`map:\\s*"${finalName}"`));
  }
});

test('tenant-bound hospitality inventory relation and lookup tuples remain unchanged', () => {
  assert.match(schema, /fields: \[roomTypeId, propertyId, organizationId\], references: \[id, propertyId, organizationId\]/);
  assert.match(schema, /fields: \[ratePlanId, propertyId, organizationId\], references: \[id, propertyId, organizationId\]/);
  assert.match(schema, /@@index\(\[organizationId, propertyId, ratePlanId, status, startDate\], map: "hospitality_restrictions_rate_plan_dates_idx"\)/);
  assert.match(schema, /@@index\(\[organizationId, propertyId, roomTypeId, status, startDate\], map: "hospitality_restrictions_room_type_dates_idx"\)/);
  assert.match(schema, /@@index\(\[organizationId, propertyId, roomTypeId, status, startDate\], map: "hospitality_availability_windows_scope_start_idx"\)/);
});
