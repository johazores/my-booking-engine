import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const migrationPath = 'prisma/migrations/20260919212500-rental-parent-lifecycle-authority/migration.sql';

test('application writers serialize fresh child authority with parent archival', async () => {
  const service = await source('src/server/inventory/rental-service.ts');

  assert.match(service, /createRentalUnit[\s\S]*lockRentalUnitTypeLifecycle\(transaction, input\.organizationId, unit\.unitTypeId\)[\s\S]*lockRentalLocationLifecycle\(transaction, input\.organizationId, locationLocator\.id\)[\s\S]*status: 'ACTIVE'[\s\S]*rentalUnit\.create/);
  assert.match(service, /assignRentalUnitLocation[\s\S]*lockRentalUnit\(transaction, input\.organizationId, input\.unitId\)[\s\S]*lockRentalUnitTypeLifecycle\(transaction, input\.organizationId, unit\.unitTypeId\)[\s\S]*lockRentalLocationLifecycle\(transaction, input\.organizationId, locationLocator\.id\)[\s\S]*status: 'ACTIVE'[\s\S]*data: \{ locationId: location\.id \}/);
  assert.match(service, /createRentalRatePeriod[\s\S]*lockRentalUnitTypeLifecycle\(transaction, input\.organizationId, rate\.unitTypeId\)[\s\S]*status: 'ACTIVE'[\s\S]*rentalRatePeriod\.create/);
  assert.match(service, /archiveRentalLocation[\s\S]*lockRentalLocationLifecycle\(transaction, input\.organizationId, input\.locationId\)[\s\S]*status: 'ACTIVE'[\s\S]*readRentalInventoryDatabaseClock\(transaction, 'rental location archival'\)/);
  assert.match(service, /archiveRentalUnitType[\s\S]*lockRentalUnitTypeLifecycle\(transaction, input\.organizationId, input\.unitTypeId\)[\s\S]*status: 'ACTIVE'[\s\S]*readRentalInventoryDatabaseClock\(transaction, 'rental unit-type archival'\)/);
});

test('database child guards share deterministic tenant-scoped parent lifecycle locks', async () => {
  const migration = await source(migrationPath);

  assert.match(migration, /sf:rental-unit-type-lifecycle:/);
  assert.match(migration, /sf:rental-location-lifecycle:/);
  assert.match(migration, /PERFORM sf_lock_rental_unit_type_lifecycle\(NEW\."organizationId", NEW\."unitTypeId"\)[\s\S]*PERFORM sf_lock_rental_location_lifecycle\(NEW\."organizationId", NEW\."locationId"\)/);
  assert.match(migration, /unit_type\."organizationId" = NEW\."organizationId"/);
  assert.match(migration, /location\."organizationId" = NEW\."organizationId"/);
  assert.match(migration, /CREATE TRIGGER b_rental_units_parent_lifecycle_guard/);
  assert.match(migration, /WHEN \(NEW\."status" = 'ACTIVE'\)/);
  assert.match(migration, /CREATE TRIGGER rental_rate_periods_parent_lifecycle_guard/);
});

test('database parent archive guards serialize and reject active physical dependencies', async () => {
  const migration = await source(migrationPath);

  assert.match(migration, /sf_guard_rental_location_archive_dependencies/);
  assert.match(migration, /sf_lock_rental_location_lifecycle\(NEW\."organizationId", NEW\."id"\)/);
  assert.match(migration, /unit\."organizationId" = NEW\."organizationId"[\s\S]*unit\."locationId" = NEW\."id"[\s\S]*unit\."status" = 'ACTIVE'/);
  assert.match(migration, /sf_guard_rental_unit_type_archive_dependencies/);
  assert.match(migration, /sf_lock_rental_unit_type_lifecycle\(NEW\."organizationId", NEW\."id"\)/);
  assert.match(migration, /unit\."organizationId" = NEW\."organizationId"[\s\S]*unit\."unitTypeId" = NEW\."id"[\s\S]*unit\."status" = 'ACTIVE'/);
});

test('documentation keeps retained history and unsupported product semantics explicit', async () => {
  const docs = await source('docs/rental-parent-lifecycle-authority.md');

  assert.match(docs, /does not delete historical units, bookings, rate periods, or evidence/i);
  assert.match(docs, /customer pickup\/drop-off semantics/);
  assert.match(docs, /GitHub Actions are not required or used/);
});
