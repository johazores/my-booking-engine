import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const migrationPath = 'prisma/migrations/20260919203500_rental_return_inspection_archive_authority/migration.sql';

test('direct return-inspection inserts serialize with physical-unit lifecycle mutations', async () => {
  const migration = await source(migrationPath);

  assert.match(migration, /CREATE TRIGGER a_rental_return_inspections_unit_lock_guard/);
  assert.match(migration, /BEFORE INSERT ON "rental_return_inspections"/);
  assert.match(migration, /sf_lock_rental_unit_before_operational_evidence_insert/);
});

test('non-clear return inspection blocks archive until retained damage resolution is terminal', async () => {
  const migration = await source(migrationPath);

  assert.match(migration, /CREATE FUNCTION sf_guard_rental_unit_archive_with_unresolved_return_inspection/);
  assert.match(migration, /inspection\."organizationId" = NEW\."organizationId"/);
  assert.match(migration, /inspection\."unitId" = NEW\."id"/);
  assert.match(migration, /inspection\."outcome" IN \('DAMAGE_REPORTED', 'UNSAFE'\)/);
  assert.match(migration, /damage_case\."organizationId" = inspection\."organizationId"/);
  assert.match(migration, /damage_case\."inspectionId" = inspection\."id"/);
  assert.match(migration, /damage_case\."unitId" = inspection\."unitId"/);
  assert.match(migration, /damage_case\."status" IN \('WAIVED', 'CLOSED'\)/);
  assert.match(migration, /unresolved non-clear return inspection evidence and cannot be archived/i);
});

test('existing inspection and damage authoring contracts preserve the lifecycle prerequisites', async () => {
  const [inspection, damage] = await Promise.all([
    source('prisma/migrations/20260916232000_rental_return_inspections/migration.sql'),
    source('prisma/migrations/20260917003500_rental_damage_cases/migration.sql'),
  ]);

  assert.match(inspection, /rental return inspection requires an active retained unit/i);
  assert.match(inspection, /non-clear rental return inspection requires the unit to be out of service/i);
  assert.match(damage, /rental damage case requires matching non-clear return inspection evidence/i);
  assert.match(damage, /rental damage case requires an active retained unit/i);
});

test('documentation keeps inspection, damage resolution, and archive authority connected', async () => {
  const docs = await source('docs/rental-unit-mutation-authority.md');

  assert.match(docs, /non-clear return inspection/i);
  assert.match(docs, /`WAIVED` or `CLOSED`/);
  assert.match(docs, /cannot archive the unit before opening that damage workflow/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
