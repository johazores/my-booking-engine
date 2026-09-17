import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const schema = fs.readFileSync('prisma/rental-damage-case.prisma', 'utf8');
const inspectionSchema = fs.readFileSync('prisma/rental-return-inspection.prisma', 'utf8');
const inventorySchema = fs.readFileSync('prisma/rental-inventory.prisma', 'utf8');
const migration = fs.readFileSync('prisma/migrations/20260917003500_rental_damage_cases/migration.sql', 'utf8');
const service = fs.readFileSync('src/server/bookings/rental-damage-case-service.ts', 'utf8');
const operationalService = fs.readFileSync('src/server/inventory/rental-unit-operational-service.ts', 'utf8');
const panel = fs.readFileSync('src/components/rental-damage-case-panel.tsx', 'utf8');
const inspectionPanel = fs.readFileSync('src/components/rental-return-inspection-panel.tsx', 'utf8');
const openRoute = fs.readFileSync('app/api/inventory/rentals/bookings/[booking-id]/damage-case/route.ts', 'utf8');
const transitionRoute = fs.readFileSync('app/api/inventory/rentals/bookings/[booking-id]/damage-case/[case-id]/route.ts', 'utf8');
const docs = fs.readFileSync('docs/rental-damage-case.md', 'utf8');
const operationalDocs = fs.readFileSync('docs/rental-unit-operational-availability.md', 'utf8');
const bookingDocs = fs.readFileSync('docs/rental-booking-foundation.md', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');

const production = [service, operationalService, panel, inspectionPanel, openRoute, transitionRoute].join('\n');

test('damage case schema is tenant-bound, one-per-booking/inspection, and linked from rental evidence', () => {
  assert.match(schema, /model RentalDamageCase/);
  assert.match(schema, /@@unique\(\[organizationId, bookingId\]/);
  assert.match(schema, /@@unique\(\[organizationId, inspectionId\]/);
  assert.match(schema, /@@unique\(\[organizationId, idempotencyKey\]/);
  assert.match(schema, /booking\s+RentalBooking\s+@relation\(fields: \[bookingId, organizationId\]/);
  assert.match(schema, /inspection\s+RentalReturnInspection\s+@relation\(fields: \[inspectionId, organizationId\]/);
  assert.match(schema, /unit\s+RentalUnit\s+@relation\("RentalDamageCaseUnit", fields: \[unitId, organizationId\]/);
  assert.match(schema, /liabilityDecision\s+RentalDamageLiabilityDecision\?/);
  assert.match(inspectionSchema, /damageCase\s+RentalDamageCase\?/);
  assert.match(inventorySchema, /damageCases\s+RentalDamageCase\[\]/);
  assert.match(inventorySchema, /damageCase\s+RentalDamageCase\?/);
});

test('damage case writer derives authority server-side and revalidates tenant inspection/unit scope', () => {
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /permission: 'inventory:manage'/);
  assert.match(service, /permission: 'booking:read'/);
  assert.match(service, /const idempotencyKey = `rental-damage-case:\$\{input\.bookingId\}`/);
  assert.match(service, /outcome: \{ in: \['DAMAGE_REPORTED', 'UNSAFE'\] \}/);
  assert.match(service, /organizationId: input\.organizationId/g);
  assert.match(service, /rentalUnitLockKey\(input\.organizationId, inspection\.unitId\)/);
  assert.match(service, /status: 'OUT_OF_SERVICE'/);
  assert.match(service, /currency: booking\.currency/);
  assert.doesNotMatch(service, /idempotencyKey:\s*input\./);
});

test('PostgreSQL authors lifecycle evidence and blocks bypass of unresolved physical damage', () => {
  assert.match(migration, /NEW\."idempotencyKey" <> \('rental-damage-case:' \|\| NEW\."bookingId"::text\)/);
  assert.match(migration, /inspection\."outcome" IN \('DAMAGE_REPORTED', 'UNSAFE'\)/);
  assert.match(migration, /booking\."currency" = NEW\."currency"/);
  assert.match(migration, /operational_state\."status" = 'OUT_OF_SERVICE'/);
  assert.match(migration, /authored_at := clock_timestamp\(\)/);
  assert.match(migration, /terminal rental damage cases are immutable/);
  assert.match(migration, /rental damage cases cannot be deleted/);
  assert.match(migration, /damage_case\."status" IN \('OPEN', 'ASSESSED'\)/);
  assert.match(migration, /rental unit has an unresolved damage case/);
  assert.match(migration, /cannot be archived/);
  assert.match(operationalService, /rentalDamageCase\.count/);
  assert.match(operationalService, /status: \{ in: \['OPEN', 'ASSESSED'\] \}/);
  assert.match(operationalService, /Waive or close unresolved damage cases/);
});

test('staff workflow exposes real case actions without presenting repair estimate as settlement', () => {
  assert.match(inspectionPanel, /RentalDamageCasePanel/);
  assert.match(panel, /Open damage case/);
  assert.match(panel, /Record assessment/);
  assert.match(panel, /Waive damage case/);
  assert.match(panel, /Close damage case/);
  assert.match(panel, /repair estimate is operational evidence only/);
  assert.match(openRoute, /openRentalDamageCase/);
  assert.match(transitionRoute, /assessRentalDamageCase/);
  assert.match(transitionRoute, /waiveRentalDamageCase/);
  assert.match(transitionRoute, /closeRentalDamageCase/);
  assert.doesNotMatch(production, /recordRentalManualPayment|refundRentalManualPayment|stripe|paymentTransaction\.create/);
});

test('documentation keeps repair evidence operational while linking the separate post-closure liability decision', () => {
  assert.match(docs, /separate append-only customer-liability decision/i);
  assert.match(docs, /security bonds\/deposits/i);
  assert.match(docs, /does not automatically make the unit available/i);
  assert.match(operationalDocs, /unresolved damage case/i);
  assert.match(operationalDocs, /repair estimate is operational evidence only/i);
  assert.match(bookingDocs, /damage-case assessment records operational repair-estimate evidence only/i);
  assert.match(readme, /return-inspection\/damage-case\/damage-liability infrastructure/i);
  assert.match(readme, /docs\/rental-damage-case\.md/);
});
