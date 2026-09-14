import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('rental hold schema and migrations preserve tenant scope, overlap authority, and complete pricing evidence', async () => {
  const [schema, holdMigration, pricingMigration] = await Promise.all([
    source('prisma/rental-inventory.prisma'),
    source('prisma/migrations/20260914154000_rental_availability_holds/migration.sql'),
    source('prisma/migrations/20260914161000_rental_hold_pricing_evidence/migration.sql'),
  ]);

  assert.match(schema, /model RentalAvailabilityHold \{/);
  assert.match(schema, /status\s+AvailabilityHoldStatus\s+@default\(ACTIVE\)/);
  assert.match(schema, /quotedCurrency\s+String\?\s+@db\.Char\(3\)/);
  assert.match(schema, /quotedTotalMinor\s+BigInt\?\s+@db\.BigInt/);
  assert.match(schema, /pricingFingerprint\s+String\?\s+@db\.Char\(64\)/);
  assert.match(schema, /pricingSnapshot\s+Json\?/);
  assert.match(schema, /pricingObservedAt\s+DateTime\?\s+@db\.Timestamptz\(6\)/);
  assert.match(schema, /@@unique\(\[organizationId, idempotencyKey\]\)/);
  assert.match(schema, /unit RentalUnit @relation\(fields: \[unitId, organizationId\], references: \[id, organizationId\]/);
  assert.match(schema, /availabilityHolds\s+RentalAvailabilityHold\[\]/);

  assert.match(holdMigration, /rental_availability_holds_unitId_organizationId_fkey/);
  assert.match(holdMigration, /rental_availability_holds_date_range_check/);
  assert.match(holdMigration, /rental_availability_holds_state_check/);
  assert.match(holdMigration, /pg_advisory_xact_lock/);
  assert.match(holdMigration, /rental_availability_holds_overlap_guard/);
  assert.match(holdMigration, /rental_availability_blocks_hold_guard/);
  assert.match(holdMigration, /rental_units_active_hold_guard/);
  assert.match(holdMigration, /ERRCODE = '23P01'/);

  assert.match(pricingMigration, /rental_availability_holds_pricing_evidence_complete_check/);
  assert.match(pricingMigration, /"quotedCurrency" IS NULL[\s\S]*"pricingObservedAt" IS NULL/);
  assert.match(pricingMigration, /"quotedCurrency" IS NOT NULL[\s\S]*"pricingObservedAt" IS NOT NULL/);
  assert.match(pricingMigration, /rental_availability_holds_pricing_fingerprint_check/);
  assert.match(pricingMigration, /jsonb_typeof\("pricingSnapshot"\) = 'object'/);
  assert.match(pricingMigration, /rental_availability_holds_pricing_evidence_immutable_guard/);
  assert.match(pricingMigration, /rental hold pricing evidence is immutable/);
});

test('rental hold service enforces permissions, exact idempotency, tenant scope, pricing evidence, and bounded effective reads', async () => {
  const service = await source('src/server/inventory/rental-hold-service.ts');
  const domain = await source('src/server/inventory/rental-hold-domain.ts');

  assert.match(service, /permission: 'availability:manage'/);
  assert.match(service, /permission: 'availability:read'/);
  assert.match(service, /permission: 'pricing:read'/);
  assert.match(service, /permission: 'inventory:manage'/);
  assert.match(service, /organizationId_idempotencyKey/);
  assert.match(service, /buildRentalPricingEvidence/);
  assert.match(service, /quotedTotalMinor: BigInt\(pricingEvidence\.totalMinor\)/);
  assert.match(service, /pricingSnapshot: toJsonInput\(pricingEvidence\.snapshot\)/);
  assert.match(service, /pricingObservedAt: now/);
  assert.match(service, /readRentalAvailabilityHoldPricingReview/);
  assert.match(service, /pricingState = !complete[\s\S]*'LEGACY'[\s\S]*'CURRENT'[\s\S]*'CHANGED'/);
  assert.match(service, /organizationId: input\.organizationId,\s*unitId: unit\.id,\s*status: 'ACTIVE'/s);
  assert.match(service, /expiresAt: \{ gt: now \}/);
  assert.match(service, /availability\.rental-hold\.created/);
  assert.match(service, /availability\.rental-hold\.released/);
  assert.match(service, /assertRentalAvailabilityBlockNotHeld/);
  assert.match(service, /assertRentalUnitNotHeldForInventoryMutation/);
  assert.match(domain, /expiresAt\.getTime\(\) - input\.hold\.createdAt\.getTime\(\) === requestedDurationMilliseconds/);
});

test('rental availability and hold UI expose real inventory protection plus current-vs-observed pricing review', async () => {
  const [availability, preview, holdsPage, detailPage, createRoute, releaseRoute, blockRoute, locationRoute, archiveRoute] = await Promise.all([
    source('src/server/inventory/rental-availability-service.ts'),
    source('app/inventory/rentals/availability/page.tsx'),
    source('app/inventory/rentals/holds/page.tsx'),
    source('app/inventory/rentals/holds/[hold-id]/page.tsx'),
    source('app/api/inventory/rentals/holds/route.ts'),
    source('app/api/inventory/rentals/holds/[hold-id]/release/route.ts'),
    source('app/api/inventory/rentals/units/[unit-id]/blocks/route.ts'),
    source('app/api/inventory/rentals/units/[unit-id]/location/route.ts'),
    source('app/api/inventory/rentals/units/[unit-id]/archive/route.ts'),
  ]);

  assert.match(availability, /availabilityHolds:\s*\{\s*none:/s);
  assert.match(availability, /buildRentalPricingEvidence/);
  assert.match(availability, /fingerprint: pricingEvidence\.fingerprint/);
  assert.match(preview, /action="\/api\/inventory\/rentals\/holds"/);
  assert.match(preview, /Hold 15 minutes/);
  assert.match(preview, /not a customer booking, reservation, payment/i);
  assert.match(holdsPage, /listRentalAvailabilityHolds/);
  assert.match(holdsPage, /Observed quote:/);
  assert.match(holdsPage, /href=\{`\/inventory\/rentals\/holds\/\$\{hold\.id\}`\}/);
  assert.match(detailPage, /readRentalAvailabilityHoldPricingReview/);
  assert.match(detailPage, /Configured pricing changed after this hold was created/);
  assert.match(detailPage, /does not lock price/i);
  assert.match(detailPage, /pricing:read/);
  assert.match(detailPage, /Release hold/);
  assert.match(createRoute, /createRentalAvailabilityHold/);
  assert.match(createRoute, /hold\.status === 'ACTIVE'/);
  assert.match(createRoute, /hold-inactive/);
  assert.match(releaseRoute, /releaseRentalAvailabilityHold/);
  assert.match(blockRoute, /assertRentalAvailabilityBlockNotHeld/);
  assert.match(locationRoute, /assertRentalUnitNotHeldForInventoryMutation/);
  assert.match(archiveRoute, /assertRentalUnitNotHeldForInventoryMutation/);
});

test('rental hold database scenario covers pricing evidence drift without claiming booking conversion', async () => {
  const integration = await source('src/server/inventory/rental-hold.integration.ts');

  assert.match(integration, /quotedTotalMinor, 375000n/);
  assert.match(integration, /pricingState, 'CURRENT'/);
  assert.match(integration, /dailyRateMinor: 150000/);
  assert.match(integration, /pricingState, 'CHANGED'/);
  assert.match(integration, /current\.totalMinor, 450000n/);
  assert.match(integration, /expiresInMinutes: 20/);
  assert.doesNotMatch(integration, /createRentalBooking|confirmRentalBooking|consumeRentalHold/);
});

test('rental hold documentation and guarded database runner keep pricing and booking boundaries explicit', async () => {
  const [docs, runner] = await Promise.all([
    source('docs/rental-inventory.md'),
    source('scripts/run-database-tests.mjs'),
  ]);

  assert.match(docs, /creation-time pricing evidence/i);
  assert.match(docs, /canonical SHA-256 pricing fingerprint/i);
  assert.match(docs, /not a customer reservation/i);
  assert.match(docs, /does not lock pricing/i);
  assert.match(docs, /current fingerprint still matches the original observation/i);
  assert.match(docs, /database.*guard/i);
  assert.match(runner, /src\/server\/inventory\/rental-hold\.integration\.ts/);
});
