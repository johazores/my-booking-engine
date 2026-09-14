import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('rental hold schema and migrations preserve tenant scope, overlap authority, and complete pricing evidence', async () => {
  const [schema, holdMigration, pricingMigration, lockDomain] = await Promise.all([
    source('prisma/rental-inventory.prisma'),
    source('prisma/migrations/20260914154000_rental_availability_holds/migration.sql'),
    source('prisma/migrations/20260914161000_rental_hold_pricing_evidence/migration.sql'),
    source('src/server/inventory/rental-lock-domain.ts'),
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
  assert.match(lockDomain, /sf:rental-unit:\$\{organizationId\}:\$\{unitId\}/);

  assert.match(pricingMigration, /rental_availability_holds_pricing_evidence_complete_check/);
  assert.match(pricingMigration, /"quotedCurrency" IS NULL[\s\S]*"pricingObservedAt" IS NULL/);
  assert.match(pricingMigration, /"quotedCurrency" IS NOT NULL[\s\S]*"pricingObservedAt" IS NOT NULL/);
  assert.match(pricingMigration, /rental_availability_holds_pricing_fingerprint_check/);
  assert.match(pricingMigration, /jsonb_typeof\("pricingSnapshot"\) = 'object'/);
  assert.match(pricingMigration, /rental_availability_holds_pricing_evidence_immutable_guard/);
  assert.match(pricingMigration, /rental hold pricing evidence is immutable/);
});

test('rental hold and inventory services enforce permissions, exact idempotency, tenant scope, pricing evidence, shared locking, and service-level hold protection', async () => {
  const [holdService, rentalService, domain] = await Promise.all([
    source('src/server/inventory/rental-hold-service.ts'),
    source('src/server/inventory/rental-service.ts'),
    source('src/server/inventory/rental-hold-domain.ts'),
  ]);

  assert.match(holdService, /permission: 'availability:manage'/);
  assert.match(holdService, /permission: 'availability:read'/);
  assert.match(holdService, /permission: 'pricing:read'/);
  assert.doesNotMatch(holdService, /permission: 'inventory:manage'/);
  assert.match(holdService, /organizationId_idempotencyKey/);
  assert.match(holdService, /buildRentalPricingEvidence/);
  assert.match(holdService, /quotedTotalMinor: BigInt\(pricingEvidence\.totalMinor\)/);
  assert.match(holdService, /pricingSnapshot: toJsonInput\(pricingEvidence\.snapshot\)/);
  assert.match(holdService, /pricingObservedAt: now/);
  assert.match(holdService, /readRentalAvailabilityHoldPricingReview/);
  assert.match(holdService, /pricingState = !complete[\s\S]*'LEGACY'[\s\S]*'CURRENT'[\s\S]*'CHANGED'/);
  assert.match(holdService, /organizationId: input\.organizationId,\s*unitId: unit\.id,\s*status: 'ACTIVE'/s);
  assert.match(holdService, /expiresAt: \{ gt: now \}/);
  assert.match(holdService, /availability\.rental-hold\.created/);
  assert.match(holdService, /availability\.rental-hold\.released/);
  assert.match(holdService, /import \{ rentalUnitLockKey \} from '\.\/rental-lock-domain\.ts';/);
  assert.doesNotMatch(holdService, /function rentalUnitLockKey/);
  assert.doesNotMatch(holdService, /assertRentalAvailabilityBlockNotHeld|assertRentalUnitNotHeldForInventoryMutation/);

  assert.match(rentalService, /rentalUnitLockKey/);
  assert.match(rentalService, /pg_advisory_xact_lock/);
  assert.match(rentalService, /Release the overlapping rental availability hold before adding this unavailable-date block/);
  assert.match(rentalService, /Release active rental availability holds before relocating this rental unit/);
  assert.match(rentalService, /Release active rental availability holds before archiving this rental unit/);
  assert.match(rentalService, /assignRentalUnitLocation[\s\S]*lockRentalUnit\(transaction, input\.organizationId, input\.unitId\)/);
  assert.match(rentalService, /createRentalAvailabilityBlock[\s\S]*lockRentalUnit\(transaction, input\.organizationId, block\.unitId\)/);
  assert.match(rentalService, /archiveRentalUnit[\s\S]*lockRentalUnit\(transaction, input\.organizationId, input\.unitId\)/);
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
  assert.match(blockRoute, /createRentalAvailabilityBlock/);
  assert.match(locationRoute, /assignRentalUnitLocation/);
  assert.match(archiveRoute, /archiveRentalUnit/);
  assert.doesNotMatch(blockRoute, /assertRentalAvailabilityBlockNotHeld/);
  assert.doesNotMatch(locationRoute, /assertRentalUnitNotHeldForInventoryMutation/);
  assert.doesNotMatch(archiveRoute, /assertRentalUnitNotHeldForInventoryMutation/);
});

test('rental hold database scenario covers pricing evidence drift and direct service-level inventory protection without claiming booking conversion', async () => {
  const integration = await source('src/server/inventory/rental-hold.integration.ts');

  assert.match(integration, /quotedTotalMinor, 375000n/);
  assert.match(integration, /pricingState, 'CURRENT'/);
  assert.match(integration, /dailyRateMinor: 150000/);
  assert.match(integration, /pricingState, 'CHANGED'/);
  assert.match(integration, /current\.totalMinor, 450000n/);
  assert.match(integration, /expiresInMinutes: 20/);
  assert.match(integration, /Release the overlapping rental availability hold/);
  assert.match(integration, /Release active rental availability holds before relocating/);
  assert.match(integration, /Release active rental availability holds before archiving/);
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
  assert.match(docs, /Application services perform the same expected-state checks first/i);
  assert.match(docs, /database.*guard/i);
  assert.match(runner, /src\/server\/inventory\/rental-hold\.integration\.ts/);
});
