import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const byteLength = (name) => Buffer.byteLength(name, 'utf8');
const storedName = (name) => Buffer.from(name, 'utf8').subarray(0, 63).toString('utf8');

const foundationMigration = read('prisma/migrations/20260903013000_commercial-booking-amendments/migration.sql');
const portabilityMigration = read('prisma/migrations/20260922081500-hospitality-commercial-amendment-identifier-portability/migration.sql');
const amendmentSchema = read('prisma/hospitality-booking-commercial-amendments.prisma');

const expectedRenames = [
  [
    'hospitality_booking_commercial_amendments_current_room_type_fkey',
    'hospitality_commercial_amendments_current_room_type_fkey',
  ],
  [
    'hospitality_booking_commercial_amendments_current_rate_plan_fkey',
    'hospitality_commercial_amendments_current_rate_plan_fkey',
  ],
  [
    'hospitality_booking_commercial_amendments_org_booking_status_expiry_idx',
    'hospitality_commercial_amendments_booking_status_expiry_idx',
  ],
];

test('foundation creates the known PostgreSQL-truncated commercial amendment identifiers', () => {
  for (const [legacyName] of expectedRenames) {
    assert.ok(byteLength(legacyName) > 63, `${legacyName} must reproduce the historical overlong identifier`);
    assert.match(foundationMigration, new RegExp(`"${legacyName}"`));
    assert.equal(byteLength(storedName(legacyName)), 63);
  }

  assert.equal(
    new Set(expectedRenames.map(([legacyName]) => storedName(legacyName))).size,
    expectedRenames.length,
    'the historical names must truncate to distinct stored identifiers',
  );
});

test('portability migration renames exact stored identifiers to bounded unique names', () => {
  const constraintRenames = [...portabilityMigration.matchAll(/RENAME CONSTRAINT "([^"]+)"\s+TO "([^"]+)"/g)]
    .map((match) => [match[1], match[2]]);
  const indexRenames = [...portabilityMigration.matchAll(/ALTER INDEX "([^"]+)"\s+RENAME TO "([^"]+)"/g)]
    .map((match) => [match[1], match[2]]);

  const expectedStoredRenames = expectedRenames.map(([legacyName, destination]) => [
    storedName(legacyName),
    destination,
  ]);

  assert.deepEqual([...constraintRenames, ...indexRenames], expectedStoredRenames);

  for (const [source, destination] of expectedStoredRenames) {
    assert.equal(byteLength(source), 63, `${source} must be the exact stored PostgreSQL identifier`);
    assert.ok(byteLength(destination) <= 63, `${destination} must fit the PostgreSQL identifier limit`);
  }

  assert.equal(
    new Set(expectedStoredRenames.map(([, destination]) => destination)).size,
    expectedStoredRenames.length,
  );
  assert.doesNotMatch(portabilityMigration, /\b(?:CREATE|DROP|INSERT|UPDATE|DELETE)\b/i);
});

test('Prisma maps the final physical foreign-key and index names', () => {
  for (const [legacyName, destination] of expectedRenames) {
    assert.doesNotMatch(amendmentSchema, new RegExp(`map: "${legacyName}"`));
    assert.match(amendmentSchema, new RegExp(`map: "${destination}"`));
  }
});

test('commercial amendment tenant authority and lookup tuples remain unchanged', () => {
  assert.match(
    amendmentSchema,
    /currentRoomType\s+HospitalityRoomType\s+@relation\("HospitalityCommercialAmendmentCurrentRoomType", fields: \[currentRoomTypeId, propertyId, organizationId\], references: \[id, propertyId, organizationId\], onDelete: Restrict, onUpdate: Cascade, map: "hospitality_commercial_amendments_current_room_type_fkey"\)/,
  );
  assert.match(
    amendmentSchema,
    /currentRatePlan\s+HospitalityRatePlan\s+@relation\("HospitalityCommercialAmendmentCurrentRatePlan", fields: \[currentRatePlanId, propertyId, organizationId\], references: \[id, propertyId, organizationId\], onDelete: Restrict, onUpdate: Cascade, map: "hospitality_commercial_amendments_current_rate_plan_fkey"\)/,
  );
  assert.match(
    amendmentSchema,
    /@@index\(\[organizationId, bookingId, status, expiresAt\], map: "hospitality_commercial_amendments_booking_status_expiry_idx"\)/,
  );
});
