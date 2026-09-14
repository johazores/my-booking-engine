import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('rental root inventory rows are database-bound to organizations', async () => {
  const migration = await source('prisma/migrations/20260914151000_rental_tenant_integrity/migration.sql');

  assert.match(
    migration,
    /ALTER TABLE "rental_unit_types"[\s\S]*FOREIGN KEY \("organizationId"\) REFERENCES "organizations"\("id"\)[\s\S]*ON DELETE RESTRICT ON UPDATE CASCADE/,
  );
  assert.match(
    migration,
    /ALTER TABLE "rental_locations"[\s\S]*FOREIGN KEY \("organizationId"\) REFERENCES "organizations"\("id"\)[\s\S]*ON DELETE RESTRICT ON UPDATE CASCADE/,
  );
});

test('rental commercial lifecycle rows enforce status and archival timestamp consistency', async () => {
  const migration = await source('prisma/migrations/20260914151000_rental_tenant_integrity/migration.sql');

  for (const table of ['rental_unit_types', 'rental_units', 'rental_locations']) {
    assert.match(migration, new RegExp(`${table}_archive_state_check`));
  }
  assert.equal((migration.match(/\("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL\)/g) ?? []).length, 3);
  assert.equal((migration.match(/\("status" = 'ACTIVE' AND "archivedAt" IS NULL\)/g) ?? []).length, 3);
});

test('new rental root ownership matches the sibling tour and appointment database posture', async () => {
  const [tourMigration, appointmentMigration] = await Promise.all([
    source('prisma/migrations/20260914122000_tour_inventory_foundation/migration.sql'),
    source('prisma/migrations/20260914130000_appointment_inventory_foundation/migration.sql'),
  ]);

  assert.match(tourMigration, /tour_products_organization_fkey/);
  assert.match(tourMigration, /FOREIGN KEY \("organizationId"\) REFERENCES "organizations"\("id"\)/);
  assert.match(appointmentMigration, /appointment_services_organization_fkey/);
  assert.match(appointmentMigration, /appointment_staff_organization_fkey/);
  assert.equal((appointmentMigration.match(/FOREIGN KEY \("organizationId"\) REFERENCES "organizations"\("id"\)/g) ?? []).length, 2);
});

test('guarded database suite executes the rental persistence integrity scenario', async () => {
  const [runner, integration] = await Promise.all([
    source('scripts/run-database-tests.mjs'),
    source('src/server/inventory/rental-database-integrity.integration.ts'),
  ]);

  assert.match(runner, /src\/server\/inventory\/rental-database-integrity\.integration\.ts/);
  assert.match(integration, /db\.rentalUnitType\.create/);
  assert.match(integration, /db\.rentalLocation\.create/);
  assert.match(integration, /db\.organization\.delete/);
  assert.equal((integration.match(/assert\.rejects/g) ?? []).length, 6);
});

test('rental documentation records root tenant ownership and lifecycle database invariants', async () => {
  const documentation = await source('docs/rental-inventory.md');

  assert.match(documentation, /root rental unit types and locations have PostgreSQL foreign keys to their owning organization/i);
  assert.match(documentation, /status\/archive timestamp consistency is also enforced with database checks/i);
  assert.match(documentation, /dedicated guarded database-integrity scenario/i);
});
