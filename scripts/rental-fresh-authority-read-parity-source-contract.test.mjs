import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const availability = readFileSync('src/server/inventory/rental-availability-service.ts', 'utf8');
const holdService = readFileSync('src/server/inventory/rental-hold-service.ts', 'utf8');
const conversionAuthority = readFileSync('src/server/bookings/rental-booking-authority-service.ts', 'utf8');
const bookingService = readFileSync('src/server/bookings/rental-booking-service.ts', 'utf8');
const readinessHelper = readFileSync('src/server/inventory/rental-unit-operational-readiness.ts', 'utf8');
const rescheduleAuthority = readFileSync('src/server/bookings/rental-booking-reschedule-authority-service.ts', 'utf8');
const substitutionAuthority = readFileSync('src/server/bookings/rental-booking-unit-substitution-authority-service.ts', 'utf8');
const fulfillment = readFileSync('src/server/bookings/rental-booking-fulfillment-service.ts', 'utf8');
const amendmentSettlement = readFileSync('src/server/bookings/rental-booking-commercial-amendment-settlement-service.ts', 'utf8');
const readinessMigration = readFileSync(
  'prisma/migrations/20260920043000-rental-non-clear-return-readiness-authority/migration.sql',
  'utf8',
);
const authorityDocs = readFileSync('docs/rental-booking-authority.md', 'utf8');
const rescheduleDocs = readFileSync('docs/rental-booking-reschedule-authority.md', 'utf8');
const substitutionDocs = readFileSync('docs/rental-booking-unit-substitution-authority.md', 'utf8');
const writeBoundaryDocs = readFileSync('docs/rental-fresh-authority-write-boundaries.md', 'utf8');

test('availability discovery uses the shared operational-readiness predicate', () => {
  assert.match(availability, /rentalUnitOperationalReadinessWhere/);
  assert.match(availability, /\.\.\.rentalUnitOperationalReadinessWhere\(input\.organizationId\)/);
  assert.doesNotMatch(availability, /returnInspections:\s*\{[\s\S]*DAMAGE_REPORTED/);
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

test('booking conversion review uses shared readiness and refuses to mint stale authority', () => {
  assert.match(conversionAuthority, /findRentalUnitOperationalReadinessBlocker/);
  assert.match(
    conversionAuthority,
    /operationalReadinessBlocker[\s\S]*findRentalUnitOperationalReadinessBlocker\(transaction,[\s\S]*unitId: hold\.unit\.id/,
  );
  assert.match(
    conversionAuthority,
    /overdueCustodyUnitIds\.length > 0[\s\S]*operationalReadinessBlocker[\s\S]*blocker = 'INVENTORY_CONFLICT'/,
  );
  assert.doesNotMatch(conversionAuthority, /rentalUnitOperationalState\.findFirst/);
  assert.doesNotMatch(conversionAuthority, /rentalReturnInspection\.findFirst/);
});

test('fresh hold creation rechecks shared readiness after the physical-unit lock', () => {
  assert.match(holdService, /findRentalUnitOperationalReadinessBlocker/);
  assert.match(
    holdService,
    /if \(existing\)[\s\S]*return existing;[\s\S]*rentalUnitLockKey\(input\.organizationId, hold\.unitId\)[\s\S]*findRentalUnitOperationalReadinessBlocker\(transaction,[\s\S]*unitId: unit\.id/,
  );
  assert.match(holdService, /not operationally ready for a new availability hold/);
  assert.match(
    holdService,
    /findRentalUnitOperationalReadinessBlocker[\s\S]*if \(operationalReadinessBlocker\)[\s\S]*rentalAvailabilityHold\.create/,
  );
});

test('fresh booking confirmation rechecks shared readiness before consuming hold or writing booking evidence', () => {
  assert.match(bookingService, /findRentalUnitOperationalReadinessBlocker/);
  assert.match(
    bookingService,
    /if \(existing\)[\s\S]*idempotent: true[\s\S]*rentalUnitLockKey\(input\.organizationId, holdLocator\.unitId\)[\s\S]*findRentalUnitOperationalReadinessBlocker\(transaction,[\s\S]*unitId: hold\.unitId/,
  );
  assert.match(bookingService, /no longer operationally ready for booking confirmation/);
  assert.match(
    bookingService,
    /findRentalUnitOperationalReadinessBlocker[\s\S]*if \(operationalReadinessBlocker\)[\s\S]*rentalAvailabilityHold\.updateMany[\s\S]*rentalBooking\.create[\s\S]*rentalBookingAllocation\.create/,
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
  assert.match(authorityDocs, /rechecks the same shared physical-unit readiness contract under the unit lock/);
  assert.match(rescheduleDocs, /never emits reschedule or commercial-amendment review authority/);
  assert.match(substitutionDocs, /candidate list never advertises a replacement unit that the same PostgreSQL authority would reject/);
});

test('fresh pickup rechecks operational readiness under the physical-unit lock before custody write', () => {
  assert.match(fulfillment, /findRentalUnitOperationalReadinessBlocker/);
  assert.match(
    fulfillment,
    /rentalUnitLockKey\(input\.organizationId, effectiveUnitId\)[\s\S]*input\.kind === 'PICKED_UP'[\s\S]*findRentalUnitOperationalReadinessBlocker\(transaction,[\s\S]*unitId: effectiveUnitId/,
  );
  assert.match(fulfillment, /not operationally ready for pickup/);
  assert.match(
    fulfillment,
    /findRentalUnitOperationalReadinessBlocker[\s\S]*readRentalBookingSecurityBondGuardInTransaction[\s\S]*rentalBookingFulfillmentEvent\.create/,
  );
});

test('new commercial amendment adjustment settlement serializes and rechecks readiness before money evidence', () => {
  assert.match(amendmentSettlement, /rentalUnitLockKey/);
  assert.match(amendmentSettlement, /findRentalUnitOperationalReadinessBlocker/);
  assert.match(
    amendmentSettlement,
    /before\.state !== 'UNSETTLED'[\s\S]*rentalUnitLockKey\(input\.organizationId, amendment\.unitId\)[\s\S]*clock_timestamp\(\)[\s\S]*findRentalUnitOperationalReadinessBlocker\(transaction/,
  );
  assert.match(amendmentSettlement, /expired before adjustment settlement could acquire inventory authority/);
  assert.match(amendmentSettlement, /cannot be recorded while the retained physical unit is not operationally ready/);
  assert.match(
    amendmentSettlement,
    /findRentalUnitOperationalReadinessBlocker[\s\S]*assertManualReferenceUnused[\s\S]*manualProvider\.recordOffline(?:Payment|Refund)/,
  );
});

test('readiness does not block retained money recovery or idempotent adjustment replay', () => {
  const settlementStart = amendmentSettlement.indexOf('export async function recordRentalBookingCommercialAmendmentManualSettlement');
  const compensationStart = amendmentSettlement.indexOf('export async function recordRentalBookingCommercialAmendmentManualCompensation');
  assert.ok(settlementStart >= 0 && compensationStart > settlementStart);
  const settlementBody = amendmentSettlement.slice(settlementStart, compensationStart);
  const compensationBody = amendmentSettlement.slice(compensationStart);
  assert.match(settlementBody, /if \(before\.state !== 'UNSETTLED'\)[\s\S]*if \(existing\) return Object\.freeze/);
  assert.doesNotMatch(compensationBody, /findRentalUnitOperationalReadinessBlocker/);
  assert.match(writeBoundaryDocs, /compensation remains available even when the unit is operationally unavailable/);
});

test('fresh-authority documentation covers pre-booking application parity and PostgreSQL final authority', () => {
  assert.match(writeBoundaryDocs, /availability discovery, hold creation, conversion review, and booking confirmation/i);
  assert.match(writeBoundaryDocs, /Idempotent replay remains ahead of the fresh-readiness gate/);
  assert.match(writeBoundaryDocs, /PostgreSQL remains the final authority/);
  assert.match(writeBoundaryDocs, /Idempotent replay of already-retained pickup evidence is deliberately not re-blocked/);
  assert.match(writeBoundaryDocs, /refreshes PostgreSQL time after waiting for that lock/);
  assert.match(writeBoundaryDocs, /If readiness changes after a valid adjustment is recorded but before final apply, apply fails closed/);
});
