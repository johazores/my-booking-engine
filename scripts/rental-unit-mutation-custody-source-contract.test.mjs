import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const migrationPath = 'prisma/migrations/20260919192500-rental-unit-mutation-custody-authority/migration.sql';

test('relocation and archival share tenant-scoped booking and custody mutation authority', async () => {
  const service = await source('src/server/inventory/rental-service.ts');

  assert.match(service, /async function assertRentalUnitMutationAuthority/);
  assert.equal((service.match(/await assertRentalUnitMutationAuthority\(/g) ?? []).length, 2);
  assert.match(service, /FROM "rental_booking_allocations" allocation/);
  assert.match(service, /JOIN "rental_bookings" booking/);
  assert.match(service, /JOIN "rental_locations" location/);
  assert.match(service, /allocation\."organizationId" = \$\{input\.organizationId\}::uuid/);
  assert.match(service, /allocation\."unitId" = \$\{input\.unitId\}::uuid/);
  assert.match(service, /booking\."status" <> 'CANCELLED'/);
  assert.match(service, /AT TIME ZONE location\."timeZone"/);
  assert.match(service, /findOverdueRentalCustodyUnitIds\(input\.transaction/);
  assert.match(service, /Record the outstanding rental return before \$\{input\.action\} this rental unit/);
});

test('supported unit mutations sample database time after the physical-unit lock and before authority', async () => {
  const service = await source('src/server/inventory/rental-service.ts');

  for (const [functionName, writeMarker] of [
    ['assignRentalUnitLocation', 'data: { locationId: location.id }'],
    ['archiveRentalUnit', "data: { status: 'ARCHIVED', archivedAt }"],
  ]) {
    const start = service.indexOf(`export async function ${functionName}`);
    assert.ok(start >= 0, `${functionName} must exist`);
    const remainder = service.slice(start);
    const next = remainder.indexOf('\nexport async function ', 1);
    const body = next >= 0 ? remainder.slice(0, next) : remainder;
    const lockIndex = body.indexOf('await lockRentalUnit');
    const clockIndex = body.indexOf('await readRentalInventoryDatabaseClock');
    const authorityIndex = body.indexOf('await assertRentalUnitMutationAuthority');
    const writeIndex = body.indexOf(writeMarker);

    assert.ok(lockIndex >= 0, `${functionName} must acquire the physical-unit lock`);
    assert.ok(clockIndex > lockIndex, `${functionName} must sample database time after serialization`);
    assert.ok(authorityIndex > clockIndex, `${functionName} must check mutation authority after the database observation`);
    assert.ok(writeIndex > authorityIndex, `${functionName} must not mutate the unit before authority passes`);
  }
});

test('database unit-mutation guard uses post-lock wall clock, retained booking timezone, and overdue custody', async () => {
  const migration = await source(migrationPath);

  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_guard_rental_unit_mutation_against_holds\(\)/);
  const lockIndex = migration.indexOf('pg_advisory_xact_lock');
  const clockIndex = migration.indexOf('wall_clock := clock_timestamp();');
  const bookingIndex = migration.indexOf('FROM "rental_booking_allocations" allocation');
  const custodyIndex = migration.indexOf('sf_rental_unit_has_overdue_custody(');

  assert.ok(lockIndex >= 0);
  assert.ok(clockIndex > lockIndex);
  assert.ok(bookingIndex > clockIndex);
  assert.ok(custodyIndex > bookingIndex);
  assert.doesNotMatch(migration, /CURRENT_DATE|CURRENT_TIMESTAMP/);
  assert.match(migration, /JOIN "rental_locations" location/);
  assert.match(migration, /location\."organizationId" = booking\."organizationId"/);
  assert.match(migration, /allocation\."endsOn" > \(wall_clock AT TIME ZONE location\."timeZone"\)::date/);
  assert.match(migration, /record the outstanding rental return before changing this rental unit/);
});

test('documentation keeps physical-unit mutation and overdue-custody boundaries aligned', async () => {
  const [authority, overdue] = await Promise.all([
    source('docs/rental-unit-mutation-authority.md'),
    source('docs/rental-overdue-custody-availability.md'),
  ]);

  assert.match(authority, /non-cancelled allocation is still current or future/i);
  assert.match(authority, /overdue open custody/i);
  assert.match(authority, /`clock_timestamp\(\)`/);
  assert.match(authority, /retained (?:IANA )?location timezone/i);
  assert.match(overdue, /physical-unit relocation, archival, and direct retyping/i);
});
