import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('rental hold schema and migration preserve tenant scope and physical-unit overlap authority', async () => {
  const [schema, migration] = await Promise.all([
    source('prisma/rental-inventory.prisma'),
    source('prisma/migrations/20260914154000_rental_availability_holds/migration.sql'),
  ]);

  assert.match(schema, /model RentalAvailabilityHold \{/);
  assert.match(schema, /status\s+AvailabilityHoldStatus\s+@default\(ACTIVE\)/);
  assert.match(schema, /@@unique\(\[organizationId, idempotencyKey\]\)/);
  assert.match(schema, /unit RentalUnit @relation\(fields: \[unitId, organizationId\], references: \[id, organizationId\]/);
  assert.match(schema, /availabilityHolds\s+RentalAvailabilityHold\[\]/);

  assert.match(migration, /rental_availability_holds_unitId_organizationId_fkey/);
  assert.match(migration, /rental_availability_holds_date_range_check/);
  assert.match(migration, /rental_availability_holds_state_check/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /rental_availability_holds_overlap_guard/);
  assert.match(migration, /rental_availability_blocks_hold_guard/);
  assert.match(migration, /rental_units_active_hold_guard/);
  assert.match(migration, /ERRCODE = '23P01'/);
});

test('rental hold service enforces server permissions, tenant scope, idempotency, and bounded effective reads', async () => {
  const service = await source('src/server/inventory/rental-hold-service.ts');

  assert.match(service, /permission: 'availability:manage'/);
  assert.match(service, /permission: 'availability:read'/);
  assert.match(service, /permission: 'inventory:manage'/);
  assert.match(service, /organizationId_idempotencyKey/);
  assert.match(service, /organizationId: input\.organizationId,\s*unitId: unit\.id,\s*status: 'ACTIVE'/s);
  assert.match(service, /expiresAt: \{ gt: now \}/);
  assert.match(service, /isolationLevel: 'ReadCommitted'/);
  assert.match(service, /availability\.rental-hold\.created/);
  assert.match(service, /availability\.rental-hold\.released/);
  assert.match(service, /assertRentalAvailabilityBlockNotHeld/);
  assert.match(service, /assertRentalUnitNotHeldForInventoryMutation/);
});

test('rental availability and UI exclude effective holds and expose only real hold actions', async () => {
  const [availability, preview, holdsPage, createRoute, releaseRoute, blockRoute, locationRoute, archiveRoute] = await Promise.all([
    source('src/server/inventory/rental-availability-service.ts'),
    source('app/inventory/rentals/availability/page.tsx'),
    source('app/inventory/rentals/holds/page.tsx'),
    source('app/api/inventory/rentals/holds/route.ts'),
    source('app/api/inventory/rentals/holds/[hold-id]/release/route.ts'),
    source('app/api/inventory/rentals/units/[unit-id]/blocks/route.ts'),
    source('app/api/inventory/rentals/units/[unit-id]/location/route.ts'),
    source('app/api/inventory/rentals/units/[unit-id]/archive/route.ts'),
  ]);

  assert.match(availability, /availabilityHolds:\s*\{\s*none:/s);
  assert.match(availability, /status: 'ACTIVE' as const/);
  assert.match(availability, /expiresAt: \{ gt: now \}/);
  assert.match(preview, /action="\/api\/inventory\/rentals\/holds"/);
  assert.match(preview, /Hold 15 minutes/);
  assert.match(preview, /not a customer booking, reservation, payment/i);
  assert.match(holdsPage, /listRentalAvailabilityHolds/);
  assert.match(holdsPage, /Release hold/);
  assert.match(createRoute, /createRentalAvailabilityHold/);
  assert.match(createRoute, /hold\.status === 'ACTIVE'/);
  assert.match(createRoute, /hold-inactive/);
  assert.match(releaseRoute, /releaseRentalAvailabilityHold/);
  assert.match(blockRoute, /assertRentalAvailabilityBlockNotHeld/);
  assert.match(locationRoute, /assertRentalUnitNotHeldForInventoryMutation/);
  assert.match(archiveRoute, /assertRentalUnitNotHeldForInventoryMutation/);
});

test('rental hold documentation and guarded database runner keep booking boundaries explicit', async () => {
  const [docs, runner] = await Promise.all([
    source('docs/rental-inventory.md'),
    source('scripts/run-database-tests.mjs'),
  ]);

  assert.match(docs, /temporary availability holds/i);
  assert.match(docs, /not a customer reservation/i);
  assert.match(docs, /does not lock pricing/i);
  assert.match(docs, /database.*guard/i);
  assert.match(runner, /src\/server\/inventory\/rental-hold\.integration\.ts/);
});
