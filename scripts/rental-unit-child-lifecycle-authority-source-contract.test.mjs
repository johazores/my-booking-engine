import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const migrationPath = 'prisma/migrations/20260919233500-rental-unit-child-lifecycle-authority/migration.sql';

function functionBody(sql, name) {
  const start = sql.indexOf(`CREATE FUNCTION ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = sql.indexOf('\nCREATE FUNCTION ', start + 1);
  return sql.slice(start, next >= 0 ? next : sql.length);
}

test('fresh unit child authority serializes before lifecycle validation', async () => {
  const migration = await source(migrationPath);
  const body = functionBody(migration, 'sf_assert_active_rental_unit_child_authority');
  const lockIndex = body.indexOf('pg_advisory_xact_lock');
  const unitReadIndex = body.indexOf('FROM "rental_units" unit');

  assert.ok(lockIndex >= 0, 'shared physical-unit lock must be acquired');
  assert.ok(unitReadIndex > lockIndex, 'unit lifecycle must be read after serialization');
  assert.match(body, /'sf:rental-unit:' \|\| p_organization_id::text \|\| ':' \|\| p_unit_id::text/);
  assert.match(body, /unit\."organizationId" = p_organization_id/);
  assert.match(body, /JOIN "rental_unit_types" unit_type/);
  assert.match(body, /JOIN "rental_locations" location/);
  assert.match(body, /unit_status <> 'ACTIVE'/);
  assert.match(body, /unit_type_status <> 'ACTIVE'/);
  assert.match(body, /location_status <> 'ACTIVE'/);
});

test('fresh unavailable-date authority requires active physical inventory first', async () => {
  const migration = await source(migrationPath);
  assert.match(migration, /CREATE TRIGGER a_rental_availability_blocks_unit_lifecycle_guard/);
  assert.match(
    migration,
    /BEFORE INSERT OR UPDATE OF "organizationId", "unitId", "startsOn", "endsOn"\s+ON "rental_availability_blocks"/,
  );
  assert.match(
    functionBody(migration, 'sf_guard_rental_availability_block_unit_lifecycle'),
    /sf_assert_active_rental_unit_child_authority/,
  );
});

test('only live hold authority requires an active physical unit', async () => {
  const migration = await source(migrationPath);
  const body = functionBody(migration, 'sf_guard_rental_availability_hold_unit_lifecycle');

  assert.match(body, /IF NEW\."status" <> 'ACTIVE' THEN\s+RETURN NEW;/);
  assert.match(body, /sf_assert_active_rental_unit_child_authority/);
  assert.match(migration, /CREATE TRIGGER a_rental_availability_holds_unit_lifecycle_guard/);
  assert.match(
    migration,
    /BEFORE INSERT OR UPDATE OF "organizationId", "unitId", "startsOn", "endsOn", "status", "expiresAt"\s+ON "rental_availability_holds"/,
  );
});

test('operational state becomes retained history after physical-unit archival', async () => {
  const migration = await source(migrationPath);
  assert.match(migration, /CREATE TRIGGER a_rental_unit_operational_states_unit_lifecycle_guard/);
  assert.match(
    migration,
    /BEFORE INSERT OR UPDATE ON "rental_unit_operational_states"/,
  );
  assert.match(
    functionBody(migration, 'sf_guard_rental_unit_operational_state_unit_lifecycle'),
    /sf_assert_active_rental_unit_child_authority/,
  );
  assert.doesNotMatch(migration, /BEFORE DELETE ON "rental_unit_operational_states"/);
});

test('documentation states the concurrency and retained-history contract', async () => {
  const doc = await source('docs/rental-unit-child-lifecycle-authority.md');
  for (const token of [
    'sf:rental-unit:<organization-id>:<unit-id>',
    'If the child write wins first',
    'If archival wins first',
    'Inactive hold transitions remain deliberately allowed after archival',
    'Maintenance work orders already require an active tenant unit',
    'GitHub Actions are not required or used.',
  ]) {
    assert.ok(doc.includes(token), `missing lifecycle documentation token: ${token}`);
  }
});
