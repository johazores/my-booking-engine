import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fulfillment = readFileSync('src/server/bookings/rental-booking-fulfillment-service.ts', 'utf8');
const operational = readFileSync('src/server/inventory/rental-unit-operational-service.ts', 'utf8');
const migration = readFileSync('prisma/migrations/20260920033500-rental-pending-return-inspection-availability-authority/migration.sql', 'utf8');
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

test('operational release checks readiness before accepting an idempotent available request', () => {
  const availableGuardIndex = operational.indexOf("if (input.operational.status === 'AVAILABLE')");
  const pendingInspectionIndex = operational.indexOf('pendingReturnInspection', availableGuardIndex);
  const idempotentIndex = operational.indexOf('currentStatus === input.operational.status', availableGuardIndex);

  assert.ok(availableGuardIndex >= 0, 'available transition must have an explicit readiness guard');
  assert.ok(pendingInspectionIndex > availableGuardIndex, 'pending inspection must be checked for available transitions');
  assert.ok(idempotentIndex > pendingInspectionIndex, 'readiness must run before same-state idempotent success');
  assert.match(operational, /rentalBookingFulfillmentEvent\.findFirst/);
  assert.match(operational, /kind: 'RETURNED'/);
  assert.match(operational, /returnInspection: \{ is: null \}/);
  assert.match(operational, /Record the pending rental return inspection before returning this rental unit to service/);
  assert.match(operational, /status: \{ in: \['OPEN', 'IN_PROGRESS'\] \}/);
  assert.match(operational, /status: \{ in: \['OPEN', 'ASSESSED'\] \}/);
});

test('PostgreSQL serializes pending-inspection readiness with fresh rental authority and direct service release', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_assert_rental_unit_operationally_available/);
  assert.match(migration, /LANGUAGE plpgsql\s+VOLATILE/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /'sf:rental-unit:' \|\| p_organization_id::text \|\| ':' \|\| p_unit_id::text/);
  assert.match(migration, /return_event\."kind" = 'RETURNED'/);
  assert.match(migration, /NOT EXISTS \([\s\S]*FROM "rental_return_inspections" inspection[\s\S]*inspection\."returnEventId" = return_event\."id"/);
  assert.match(migration, /CREATE TRIGGER a_rental_unit_operational_states_pending_return_guard/);
  assert.match(migration, /WHEN \(NEW\."status" = 'AVAILABLE'\)/);
  assert.match(migration, /rental unit cannot return to service before return inspection is recorded/);
});

test('staff guidance and docs keep early-return calendar release separate from physical readiness', () => {
  assert.match(unitPage, /blocked while a return inspection is pending, maintenance work is active, or a damage case remains unresolved/);
  assert.match(operationalDocs, /Recording `RETURNED` now closes the availability gap/);
  assert.match(operationalDocs, /cannot be explicitly returned to `AVAILABLE`/);
  assert.match(inspectionDocs, /moves an otherwise available physical unit to `OUT_OF_SERVICE`/);
  assert.match(inspectionDocs, /A `CLEAR` inspection does not automatically return a unit to service/);
  assert.match(releaseDocs, /does not certify physical readiness for a new customer/);
  assert.match(releaseDocs, /cannot make a returned physical unit sellable before inspection/);
});
