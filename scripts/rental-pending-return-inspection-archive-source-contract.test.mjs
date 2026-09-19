import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const migrationPath = 'prisma/migrations/20260920003000-rental-pending-return-inspection-archive-guard/migration.sql';

test('database blocks archival while returned custody lacks inspection evidence', async () => {
  const migration = await source(migrationPath);

  assert.match(migration, /CREATE FUNCTION sf_guard_rental_unit_archive_with_pending_return_inspection/);
  assert.match(migration, /return_event\."organizationId" = NEW\."organizationId"/);
  assert.match(migration, /return_event\."unitId" = NEW\."id"/);
  assert.match(migration, /return_event\."kind" = 'RETURNED'/);
  assert.match(migration, /inspection\."returnEventId" = return_event\."id"/);
  assert.match(migration, /inspection\."unitId" = return_event\."unitId"/);
  assert.match(migration, /awaiting return inspection and cannot be archived/i);
});

test('supported archive readiness mirrors retained operational blockers with tenant scope', async () => {
  const service = await source('src/server/inventory/rental-unit-archive-readiness.ts');

  assert.match(service, /assertRentalUnitArchiveOperationalReadiness/);
  assert.match(service, /requireOrganizationPermission/);
  assert.match(service, /permission: 'inventory:manage'/);
  assert.match(service, /return_event\."organizationId" = \$\{input\.organizationId\}::uuid/);
  assert.match(service, /return_event\."unitId" = \$\{input\.unitId\}::uuid/);
  assert.match(service, /return_event\."kind" = 'RETURNED'/);
  assert.match(service, /inspection\."returnEventId" = return_event\."id"/);
  assert.match(service, /work_order\."status" IN \('OPEN', 'IN_PROGRESS'\)/);
  assert.match(service, /damage_case\."status" IN \('OPEN', 'ASSESSED'\)/);
  assert.match(service, /inspection\."outcome" IN \('DAMAGE_REPORTED', 'UNSAFE'\)/);
  assert.match(service, /damage_case\."status" IN \('WAIVED', 'CLOSED'\)/);
  assert.match(service, /Record the pending rental return inspection before archiving this rental unit/);
  assert.match(service, /Complete or cancel active rental maintenance before archiving this rental unit/);
  assert.match(service, /Resolve non-clear rental return inspection evidence before archiving this rental unit/);
  assert.match(service, /Waive or close the unresolved rental damage case before archiving this rental unit/);
});

test('supported archive route performs comprehensive readiness preflight before mutation', async () => {
  const route = await source('app/api/inventory/rentals/units/[unit-id]/archive/route.ts');
  const readinessIndex = route.indexOf('await assertRentalUnitArchiveOperationalReadiness');
  const archiveIndex = route.indexOf('await archiveRentalUnit');

  assert.ok(readinessIndex >= 0, 'archive operational readiness preflight must be wired');
  assert.ok(archiveIndex > readinessIndex, 'readiness preflight must run before archival mutation');
  assert.doesNotMatch(route, /assertRentalUnitArchiveReturnInspectionReady/);
});

test('supported readiness uses domain errors while PostgreSQL remains final concurrency authority', async () => {
  const service = await source('src/server/inventory/rental-unit-archive-readiness.ts');
  const docs = await source('docs/rental-pending-return-inspection-archive-authority.md');

  assert.match(service, /RentalInventoryConflictError/);
  assert.match(service, /RentalInventoryDependencyError/);
  assert.match(docs, /maintenance/i);
  assert.match(docs, /damage/i);
  assert.match(docs, /PostgreSQL remains the final lifecycle boundary/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
