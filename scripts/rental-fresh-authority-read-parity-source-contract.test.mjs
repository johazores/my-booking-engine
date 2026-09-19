import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const availability = readFileSync('src/server/inventory/rental-availability-service.ts', 'utf8');
const conversionAuthority = readFileSync('src/server/bookings/rental-booking-authority-service.ts', 'utf8');
const readinessHelper = readFileSync('src/server/inventory/rental-unit-operational-readiness.ts', 'utf8');
const rescheduleAuthority = readFileSync('src/server/bookings/rental-booking-reschedule-authority-service.ts', 'utf8');
const substitutionAuthority = readFileSync('src/server/bookings/rental-booking-unit-substitution-authority-service.ts', 'utf8');
const readinessMigration = readFileSync(
  'prisma/migrations/20260920043000-rental-non-clear-return-readiness-authority/migration.sql',
  'utf8',
);
const authorityDocs = readFileSync('docs/rental-booking-authority.md', 'utf8');
const rescheduleDocs = readFileSync('docs/rental-booking-reschedule-authority.md', 'utf8');
const substitutionDocs = readFileSync('docs/rental-booking-unit-substitution-authority.md', 'utf8');

test('availability discovery excludes unresolved returned-unit readiness evidence', () => {
  assert.match(availability, /fulfillmentEvents:\s*\{[\s\S]*none:\s*\{[\s\S]*kind: 'RETURNED'[\s\S]*returnInspection: \{ is: null \}/);
  assert.match(availability, /returnInspections:\s*\{[\s\S]*none:\s*\{[\s\S]*outcome: \{ in: \['DAMAGE_REPORTED' as const, 'UNSAFE' as const\] \}/);
  assert.match(availability, /damageCase: \{ is: null \}/);
  assert.match(availability, /status: \{ in: \['OPEN' as const, 'ASSESSED' as const\] \}/);
  assert.match(availability, /operationalState: \{ is: null \}/);
  assert.match(availability, /operationalState: \{ is: \{ status: 'AVAILABLE' as const \} \}/);
});

test('shared application readiness mirrors PostgreSQL evidence families', () => {
  assert.match(readinessHelper, /rentalUnitOperationalReadinessWhere/);
  assert.match(readinessHelper, /operationalState:\s*\{ is: null \}/);
  assert.match(readinessHelper, /status: 'AVAILABLE'/);
  assert.match(readinessHelper, /kind: 'RETURNED'/);
  assert.match(readinessHelper, /returnInspection: \{ is: null \}/);
  assert.match(readinessHelper, /outcome: \{ in: \['DAMAGE_REPORTED', 'UNSAFE'\] \}/);
  assert.match(readinessHelper, /status: \{ in: \['OPEN', 'ASSESSED'\] \}/);
  assert.match(readinessHelper, /findRentalUnitOperationalReadinessBlocker/);
  assert.match(readinessHelper, /status: 'OUT_OF_SERVICE'/);

  assert.match(readinessMigration, /rental_unit_operational_states/);
  assert.match(readinessMigration, /"status" = 'OUT_OF_SERVICE'/);
  assert.match(readinessMigration, /rental_booking_fulfillment_events/);
  assert.match(readinessMigration, /return_event\."kind" = 'RETURNED'/);
  assert.match(readinessMigration, /rental_return_inspections/);
  assert.match(readinessMigration, /inspection\."outcome" IN \('DAMAGE_REPORTED', 'UNSAFE'\)/);
  assert.match(readinessMigration, /damage_case\."status" IN \('WAIVED', 'CLOSED'\)/);
});

test('booking conversion review treats physical readiness contradictions as inventory conflicts', () => {
  assert.match(conversionAuthority, /rentalUnitOperationalState\.findFirst/);
  assert.match(conversionAuthority, /status: 'OUT_OF_SERVICE'/);
  assert.match(conversionAuthority, /rentalBookingFulfillmentEvent\.findFirst/);
  assert.match(conversionAuthority, /kind: 'RETURNED'/);
  assert.match(conversionAuthority, /returnInspection: \{ is: null \}/);
  assert.match(conversionAuthority, /rentalReturnInspection\.findFirst/);
  assert.match(conversionAuthority, /outcome: \{ in: \['DAMAGE_REPORTED', 'UNSAFE'\] \}/);
  assert.match(conversionAuthority, /damageCase: \{ is: null \}/);
  assert.match(conversionAuthority, /status: \{ in: \['OPEN', 'ASSESSED'\] \}/);
  assert.match(
    conversionAuthority,
    /overdueCustodyUnitIds\.length > 0[\s\S]*operationalState[\s\S]*pendingReturnInspection[\s\S]*unresolvedNonClearInspection[\s\S]*blocker = 'INVENTORY_CONFLICT'/,
  );
});

test('reschedule review refuses to mint fresh authority for operationally unready inventory', () => {
  assert.match(rescheduleAuthority, /findRentalUnitOperationalReadinessBlocker/);
  assert.match(
    rescheduleAuthority,
    /operationalReadinessBlocker[\s\S]*findRentalUnitOperationalReadinessBlocker\(transaction,[\s\S]*unitId: effectiveUnitId/,
  );
  assert.match(
    rescheduleAuthority,
    /overdueCustodyUnitIds\.length > 0[\s\S]*operationalReadinessBlocker[\s\S]*blocker = 'INVENTORY_CONFLICT'/,
  );
  assert.match(rescheduleDocs, /operational readiness/);
  assert.match(rescheduleDocs, /PostgreSQL fresh-rental authority/);
});

test('unit substitution candidate and review surfaces exclude operationally unready targets', () => {
  const readinessUses = substitutionAuthority.match(/rentalUnitOperationalReadinessWhere\(input\.organizationId\)/g) ?? [];
  assert.equal(readinessUses.length, 2);
  assert.match(
    substitutionAuthority,
    /const where = \{[\s\S]*rentalUnitOperationalReadinessWhere\(input\.organizationId\)[\s\S]*transaction\.rentalUnit\.count/,
  );
  assert.match(
    substitutionAuthority,
    /id: input\.targetUnitId[\s\S]*rentalUnitOperationalReadinessWhere\(input\.organizationId\)[\s\S]*if \(!targetUnit\) blocker = 'TARGET_UNAVAILABLE'/,
  );
  assert.match(substitutionDocs, /operational readiness/);
  assert.match(substitutionDocs, /PostgreSQL fresh-rental authority/);
});

test('application read readiness remains backed by PostgreSQL fresh-rental authority', () => {
  assert.match(authorityDocs, /physical-unit readiness evidence that also feeds PostgreSQL fresh-rental authority/);
  assert.match(authorityDocs, /never produces an authority fingerprint for a unit that PostgreSQL would already reject/);
  assert.match(rescheduleDocs, /never emits reschedule or commercial-amendment review authority/);
  assert.match(substitutionDocs, /candidate list never advertises a replacement unit that the same PostgreSQL authority would reject/);
});
