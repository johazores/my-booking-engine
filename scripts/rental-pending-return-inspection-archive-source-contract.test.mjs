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

test('archive readiness reader is transaction-scoped and tenant/unit exact', async () => {
  const readiness = await source('src/server/inventory/rental-unit-archive-readiness.ts');

  assert.match(readiness, /Prisma\.TransactionClient/);
  assert.match(readiness, /readRentalUnitArchiveOperationalReadiness/);
  assert.doesNotMatch(readiness, /requireOrganizationPermission/);
  assert.doesNotMatch(readiness, /\bdb\./);
  assert.match(readiness, /return_event\."organizationId" = \$\{input\.organizationId\}::uuid/);
  assert.match(readiness, /return_event\."unitId" = \$\{input\.unitId\}::uuid/);
  assert.match(readiness, /work_order\."status" IN \('OPEN', 'IN_PROGRESS'\)/);
  assert.match(readiness, /damage_case\."status" IN \('OPEN', 'ASSESSED'\)/);
  assert.match(readiness, /inspection\."outcome" IN \('DAMAGE_REPORTED', 'UNSAFE'\)/);
  assert.match(readiness, /damage_case\."status" IN \('WAIVED', 'CLOSED'\)/);
});

test('archive service checks operational readiness under the shared unit lock before mutation', async () => {
  const service = await source('src/server/inventory/rental-service.ts');
  const start = service.indexOf('export async function archiveRentalUnit');
  assert.ok(start >= 0, 'archiveRentalUnit must exist');
  const remainder = service.slice(start);
  const next = remainder.indexOf('\nexport async function ', 1);
  const archive = next >= 0 ? remainder.slice(0, next) : remainder;

  const lockIndex = archive.indexOf('await lockRentalUnit');
  const authorityIndex = archive.indexOf('await assertRentalUnitMutationAuthority');
  const readinessIndex = archive.indexOf('await readRentalUnitArchiveOperationalReadiness');
  const updateIndex = archive.indexOf("data: { status: 'ARCHIVED', archivedAt }");

  assert.ok(lockIndex >= 0, 'archive must acquire the shared unit lock');
  assert.ok(authorityIndex > lockIndex, 'booking/hold/custody authority must run after the unit lock');
  assert.ok(readinessIndex > authorityIndex, 'operational readiness must run after mutation authority while the lock is held');
  assert.ok(updateIndex > readinessIndex, 'archive mutation must run only after operational readiness');
  assert.match(archive, /Record the pending rental return inspection before archiving this rental unit/);
  assert.match(archive, /Complete or cancel active rental maintenance before archiving this rental unit/);
  assert.match(archive, /Resolve non-clear rental return inspection evidence before archiving this rental unit/);
  assert.match(archive, /Waive or close the unresolved rental damage case before archiving this rental unit/);
});

test('archive route delegates one authorized mutation path instead of a racy preflight', async () => {
  const route = await source('app/api/inventory/rentals/units/[unit-id]/archive/route.ts');

  assert.match(route, /await archiveRentalUnit/);
  assert.doesNotMatch(route, /assertRentalUnitArchiveOperationalReadiness/);
  assert.doesNotMatch(route, /rental-unit-archive-readiness/);
  assert.match(route, /inventoryErrorCode\(error\)/);
});

test('docs describe locked application authority with PostgreSQL backstops', async () => {
  const docs = await source('docs/rental-pending-return-inspection-archive-authority.md');

  assert.match(docs, /shared tenant\/unit advisory lock/i);
  assert.match(docs, /same serializable archive transaction/i);
  assert.match(docs, /PostgreSQL remains the final lifecycle boundary/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
