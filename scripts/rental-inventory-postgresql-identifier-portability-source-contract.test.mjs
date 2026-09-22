import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const byteLength = (name) => Buffer.byteLength(name, 'utf8');
const storedName = (name) => Buffer.from(name, 'utf8').subarray(0, 63).toString('utf8');

const inventoryMigration = read('prisma/migrations/20260914134500_rental_inventory_foundation/migration.sql');
const holdMigration = read('prisma/migrations/20260914154000_rental_availability_holds/migration.sql');
const portabilityMigration = read('prisma/migrations/20260922092500-rental-inventory-identifier-portability/migration.sql');
const rentalSchema = read('prisma/rental-inventory.prisma');

const expectedRenames = [
  [
    'rental_availability_blocks_organizationId_unitId_startsOn_endsOn_idx',
    'rental_availability_blocks_unit_dates_idx',
  ],
  [
    'rental_rate_periods_organizationId_unitTypeId_startsOn_endsOn_idx',
    'rental_rate_periods_unit_type_dates_idx',
  ],
  [
    'rental_availability_holds_organizationId_unitId_status_startsOn_endsOn_idx',
    'rental_availability_holds_unit_status_dates_idx',
  ],
];

const foundationSql = `${inventoryMigration}\n${holdMigration}`;

test('rental inventory foundations create only the known overlong index identifiers', () => {
  const schemaObjectNames = [...foundationSql.matchAll(/(?:CONSTRAINT|INDEX)\s+"([^"]+)"/g)].map(
    (match) => match[1],
  );
  const overlongNames = schemaObjectNames.filter((name) => byteLength(name) > 63);

  assert.deepEqual(overlongNames, expectedRenames.map(([legacyName]) => legacyName));
  for (const legacyName of overlongNames) {
    assert.equal(byteLength(storedName(legacyName)), 63);
  }
  assert.equal(new Set(overlongNames.map(storedName)).size, overlongNames.length);
});

test('portability migration renames exact stored identifiers to bounded unique names', () => {
  const renames = [...portabilityMigration.matchAll(/ALTER INDEX "([^"]+)"\s+RENAME TO "([^"]+)"/g)].map(
    (match) => [match[1], match[2]],
  );
  const expectedStoredRenames = expectedRenames.map(([legacyName, destination]) => [
    storedName(legacyName),
    destination,
  ]);

  assert.deepEqual(renames, expectedStoredRenames);
  for (const [source, destination] of renames) {
    assert.equal(byteLength(source), 63, `${source} must be the exact stored PostgreSQL identifier`);
    assert.ok(byteLength(destination) <= 63, `${destination} must fit the PostgreSQL identifier limit`);
  }
  assert.equal(new Set(renames.map(([, destination]) => destination)).size, renames.length);
  assert.doesNotMatch(portabilityMigration, /\b(?:CREATE|DROP|INSERT|UPDATE|DELETE)\b/i);
});

test('Prisma maps the final physical rental inventory index names', () => {
  for (const [legacyName, destination] of expectedRenames) {
    assert.doesNotMatch(rentalSchema, new RegExp(`map: "${legacyName}"`));
    assert.match(rentalSchema, new RegExp(`map: "${destination}"`));
  }
});

test('rental availability and rate lookup tuples remain unchanged', () => {
  assert.match(
    rentalSchema,
    /@@index\(\[organizationId, unitId, startsOn, endsOn\], map: "rental_availability_blocks_unit_dates_idx"\)/,
  );
  assert.match(
    rentalSchema,
    /@@index\(\[organizationId, unitTypeId, startsOn, endsOn\], map: "rental_rate_periods_unit_type_dates_idx"\)/,
  );
  assert.match(
    rentalSchema,
    /@@index\(\[organizationId, unitId, status, startsOn, endsOn\], map: "rental_availability_holds_unit_status_dates_idx"\)/,
  );
});

test('rental inventory tenant-bound relations remain composite', () => {
  assert.match(
    rentalSchema,
    /unit\s+RentalUnit\s+@relation\(fields: \[unitId, organizationId\], references: \[id, organizationId\], onDelete: Restrict, onUpdate: Cascade\)/,
  );
  assert.match(
    rentalSchema,
    /unitType\s+RentalUnitType\s+@relation\(fields: \[unitTypeId, organizationId\], references: \[id, organizationId\], onDelete: Restrict, onUpdate: Cascade\)/,
  );
});
