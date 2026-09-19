import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fulfillment = readFileSync('src/server/bookings/rental-booking-fulfillment-service.ts', 'utf8');
const operational = readFileSync('src/server/inventory/rental-unit-operational-service.ts', 'utf8');
const pendingInspectionMigration = readFileSync('prisma/migrations/20260920033500-rental-pending-return-inspection-availability-authority/migration.sql', 'utf8');
const nonClearReadinessMigration = readFileSync('prisma/migrations/20260920043000-rental-non-clear-return-readiness-authority/migration.sql', 'utf8');
const unitPage = readFileSync('app/inventory/rentals/units/[unit-id]/page.tsx', 'utf8');
const operationalDocs = readFileSync('docs/rental-unit-operational-availability.md', 'utf8');
const inspectionDocs = readFileSync('docs/rental-return-inspection.md', 'utf8');
const releaseDocs = readFileSync('docs/rental-early-return-inventory-release.md', 'utf8');

test('supported return quarantines an otherwise available physical unit under the existing unit lock', () => {
  const unitLockIndex = fulfillment.indexOf('rentalUnitLockKey(input.organizationId, effectiveUnitId)');
  const quarantineIndex = fulfillment.indexOf('await quarantineReturnedUnitForReadiness({', unitLockIndex);
  const returnInsertIndex = fulfillment.indexOf('transaction.rentalBookingFulfillmentEvent.create', quarantineIndex);

  assert.ok(unitLockIndex >= 0, 'fulfillment must acquire the physical-unit lock');
  assert.ok(quarantineIndex > unitLockIndex, 'return quarantine must run after the physical-unit lock');
  assert.ok(returnInsertIndex > quarantineIndex, 'new return evidence must be written after quarantine');
  assert.match(fulfillment, /RETURNED_UNIT_READINESS_REASON = 'Returned unit awaiting operational readiness review'/);
  assert.match(fulfillment, /setLockedRentalUnitOperationalStatusInTransaction/);
  assert.match(fulfillment, /status: 'OUT_OF_SERVICE'/);
});

test('idempotent return replay repairs legacy pending-inspection evidence without re-quarantining inspected returns', () => {
  assert.match(fulfillment, /returnEventId\?: string/);
  assert.match(fulfillment, /rentalReturnInspection\.findFirst\([\s\S]*returnEventId: input\.returnEventId[\s\S]*unitId: input\.unit\.id/);
  assert.match(fulfillment, /if \(inspection\) return;/);
  assert.match(fulfillment, /if \(input\.kind === 'RETURNED'\) \{[\s\S]*returnEventId: existing\.id/);
});

test('operational release checks all returned-condition readiness before accepting idempotent available state', () => {
  const availableGuardIndex = operational.indexOf("if (input.operational.status === 'AVAILABLE')");
  const pendingInspectionIndex = operational.indexOf('pendingReturnInspection', availableGuardIndex);
  const unresolvedNonClearIndex = operational.indexOf('unresolvedNonClearInspection', pendingInspectionIndex);
  const idempotentIndex = operational.indexOf('currentStatus === input.operational.status', unresolvedNonClearIndex);

  assert.ok(availableGuardIndex >= 0, 'available transition must have an explicit readiness guard');
  assert.ok(pendingInspectionIndex > availableGuardIndex, 'pending inspection must be checked for available transitions');
  assert.ok(unresolvedNonClearIndex > pendingInspectionIndex, 'non-clear inspection follow-up must be checked after pending inspection');
  assert.ok(idempotentIndex > unresolvedNonClearIndex, 'all readiness must run before same-state idempotent success');
  assert.match(operational, /rentalBookingFulfillmentEvent\.findFirst/);
  assert.match(operational, /kind: 'RETURNED'/);
  assert.match(operational, /returnInspection: \{ is: null \}/);
  assert.match(operational, /rentalReturnInspection\.findFirst/);
  assert.match(operational, /outcome: \{ in: \['DAMAGE_REPORTED', 'UNSAFE'\] \}/);
  assert.match(operational, /damageCase: \{ is: null \}/);
  assert.match(operational, /Resolve the non-clear rental return inspection through its damage case before returning this rental unit to service/);
  assert.match(operational, /status: \{ in: \['OPEN', 'IN_PROGRESS'\] \}/);
  assert.match(operational, /status: \{ in: \['OPEN', 'ASSESSED'\] \}/);
});

test('PostgreSQL serializes pending-inspection readiness with fresh rental authority and direct service release', () => {
  assert.match(pendingInspectionMigration, /CREATE OR REPLACE FUNCTION sf_assert_rental_unit_operationally_available/);
  assert.match(pendingInspectionMigration, /LANGUAGE plpgsql\s+VOLATILE/);
  assert.match(pendingInspectionMigration, /pg_advisory_xact_lock/);
  assert.match(pendingInspectionMigration, /'sf:rental-unit:' \|\| p_organization_id::text \|\| ':' \|\| p_unit_id::text/);
  assert.match(pendingInspectionMigration, /return_event\."kind" = 'RETURNED'/);
  assert.match(pendingInspectionMigration, /NOT EXISTS \([\s\S]*FROM "rental_return_inspections" inspection[\s\S]*inspection\."returnEventId" = return_event\."id"/);
  assert.match(pendingInspectionMigration, /CREATE TRIGGER a_rental_unit_operational_states_pending_return_guard/);
  assert.match(pendingInspectionMigration, /WHEN \(NEW\."status" = 'AVAILABLE'\)/);
  assert.match(pendingInspectionMigration, /rental unit cannot return to service before return inspection is recorded/);
});

test('PostgreSQL keeps non-clear returns unavailable until matching damage workflow is terminal', () => {
  assert.match(nonClearReadinessMigration, /CREATE OR REPLACE FUNCTION sf_assert_rental_unit_operationally_available/);
  assert.match(nonClearReadinessMigration, /pg_advisory_xact_lock/);
  assert.match(nonClearReadinessMigration, /inspection\."outcome" IN \('DAMAGE_REPORTED', 'UNSAFE'\)/);
  assert.match(nonClearReadinessMigration, /damage_case\."organizationId" = inspection\."organizationId"/);
  assert.match(nonClearReadinessMigration, /damage_case\."inspectionId" = inspection\."id"/);
  assert.match(nonClearReadinessMigration, /damage_case\."unitId" = inspection\."unitId"/);
  assert.match(nonClearReadinessMigration, /damage_case\."status" IN \('WAIVED', 'CLOSED'\)/);
  assert.match(nonClearReadinessMigration, /rental unit has unresolved non-clear return inspection evidence/);
  assert.match(nonClearReadinessMigration, /CREATE OR REPLACE FUNCTION sf_guard_rental_unit_available_with_pending_return_inspection/);
  assert.match(nonClearReadinessMigration, /inspection\."organizationId" = NEW\."organizationId"/);
  assert.match(nonClearReadinessMigration, /inspection\."unitId" = NEW\."unitId"/);
  assert.match(nonClearReadinessMigration, /rental unit cannot return to service while non-clear return inspection evidence is unresolved/);
});

test('staff guidance and docs keep early-return calendar release separate from complete physical readiness', () => {
  assert.match(unitPage, /blocked while a return inspection is pending, maintenance work is active, or a damage case remains unresolved/);
  assert.match(operationalDocs, /Recording `RETURNED` now closes the availability gap/);
  assert.match(operationalDocs, /cannot be explicitly returned to `AVAILABLE`/);
  assert.match(operationalDocs, /non-clear inspection remains unavailable until its matching damage case reaches `WAIVED` or `CLOSED`/);
  assert.match(inspectionDocs, /moves an otherwise available physical unit to `OUT_OF_SERVICE`/);
  assert.match(inspectionDocs, /A `CLEAR` inspection does not automatically return a unit to service/);
  assert.match(releaseDocs, /does not certify physical readiness for a new customer/);
  assert.match(releaseDocs, /cannot make a returned physical unit sellable before inspection/);
});
