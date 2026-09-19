import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const migrationPath = 'prisma/migrations/20260919202500_rental_unit_mutation_serialization/migration.sql';

test('physical-unit identity mutation locks before existing database guards run', async () => {
  const migration = await source(migrationPath);

  assert.match(migration, /CREATE TRIGGER a_rental_units_identity_mutation_lock_guard/);
  assert.match(migration, /BEFORE UPDATE OF "locationId", "unitTypeId", "status" ON "rental_units"/);
  assert.match(migration, /'sf:rental-unit:' \|\| OLD\."organizationId"::text \|\| ':' \|\| OLD\."id"::text/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /same timing\/event in name order/i);
  assert.match(migration, /before the existing rental-unit[\s\S]*maintenance, and damage archive guards/i);
});

test('fresh maintenance and damage evidence serialize through the same physical-unit lock', async () => {
  const migration = await source(migrationPath);

  assert.match(migration, /CREATE TRIGGER a_rental_maintenance_work_orders_unit_lock_guard/);
  assert.match(migration, /BEFORE INSERT ON "rental_maintenance_work_orders"/);
  assert.match(migration, /CREATE TRIGGER a_rental_damage_cases_unit_lock_guard/);
  assert.match(migration, /BEFORE INSERT ON "rental_damage_cases"/);
  assert.match(migration, /'sf:rental-unit:' \|\| NEW\."organizationId"::text \|\| ':' \|\| NEW\."unitId"::text/);
});

test('existing maintenance and damage authoring guards still require active tenant units', async () => {
  const [maintenance, damage] = await Promise.all([
    source('prisma/migrations/20260916223000_rental_maintenance_work_orders/migration.sql'),
    source('prisma/migrations/20260917003500_rental_damage_cases/migration.sql'),
  ]);

  assert.match(maintenance, /CREATE TRIGGER rental_maintenance_work_orders_authority_guard/);
  assert.match(maintenance, /rental maintenance work order requires an active tenant unit/i);
  assert.match(maintenance, /CREATE TRIGGER rental_units_active_maintenance_archive_guard/);
  assert.match(maintenance, /status" IN \('OPEN', 'IN_PROGRESS'\)/);

  assert.match(damage, /CREATE TRIGGER rental_damage_cases_authority_guard/);
  assert.match(damage, /rental damage case requires an active retained unit/i);
  assert.match(damage, /CREATE TRIGGER rental_units_active_damage_archive_guard/);
  assert.match(damage, /status" IN \('OPEN', 'ASSESSED'\)/);
});

test('supported application writers already share the database unit-lock namespace', async () => {
  const [inventory, maintenance, damage] = await Promise.all([
    source('src/server/inventory/rental-service.ts'),
    source('src/server/inventory/rental-maintenance-service.ts'),
    source('src/server/bookings/rental-damage-case-service.ts'),
  ]);

  assert.match(inventory, /rentalUnitLockKey\(organizationId, unitId\)/);
  assert.match(maintenance, /rentalUnitLockKey\(input\.organizationId, input\.unitId\)/);
  assert.match(damage, /rentalUnitLockKey\(input\.organizationId, inspection\.unitId\)/);
});

test('supported archive readiness mirrors known operational blockers inside archive service authority', async () => {
  const [readiness, inventory] = await Promise.all([
    source('src/server/inventory/rental-unit-archive-readiness.ts'),
    source('src/server/inventory/rental-service.ts'),
  ]);

  assert.match(readiness, /Prisma\.TransactionClient/);
  assert.match(readiness, /work_order\."status" IN \('OPEN', 'IN_PROGRESS'\)/);
  assert.match(readiness, /damage_case\."status" IN \('OPEN', 'ASSESSED'\)/);
  assert.match(readiness, /inspection\."outcome" IN \('DAMAGE_REPORTED', 'UNSAFE'\)/);
  assert.match(readiness, /damage_case\."status" IN \('WAIVED', 'CLOSED'\)/);
  assert.match(inventory, /await readRentalUnitArchiveOperationalReadiness\(transaction/);
  assert.match(inventory, /Complete or cancel active rental maintenance before archiving this rental unit/);
  assert.match(inventory, /Waive or close the unresolved rental damage case before archiving this rental unit/);
});

test('documentation states direct-write serialization and locked supported archive readiness', async () => {
  const docs = await source('docs/rental-unit-mutation-authority.md');

  assert.match(docs, /fresh maintenance or unresolved damage evidence/i);
  assert.match(docs, /shared tenant\/unit advisory lock/i);
  assert.match(docs, /direct SQL/i);
  assert.match(docs, /same serializable archive transaction/i);
  assert.match(docs, /pending-return-inspection/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
