import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const operationalSchema = readFileSync('prisma/rental-unit-operational-state.prisma', 'utf8');
const rentalSchema = readFileSync('prisma/rental-inventory.prisma', 'utf8');
const migration = readFileSync(
  'prisma/migrations/20260916191500_rental_unit_operational_availability/migration.sql',
  'utf8',
);
const domain = readFileSync('src/server/inventory/rental-unit-operational-domain.ts', 'utf8');
const domainTests = readFileSync('src/server/inventory/rental-unit-operational-domain.test.ts', 'utf8');
const service = readFileSync('src/server/inventory/rental-unit-operational-service.ts', 'utf8');
const availability = readFileSync('src/server/inventory/rental-availability-service.ts', 'utf8');
const route = readFileSync(
  'app/api/inventory/rentals/units/[unit-id]/operational-status/route.ts',
  'utf8',
);
const page = readFileSync('app/inventory/rentals/units/[unit-id]/page.tsx', 'utf8');
const docs = readFileSync('docs/rental-unit-operational-availability.md', 'utf8');

test('rental operational state is a tenant-owned physical-unit relation', () => {
  for (const token of [
    'enum RentalUnitOperationalStatus',
    'AVAILABLE',
    'OUT_OF_SERVICE',
    'model RentalUnitOperationalState',
    '@@unique([organizationId, unitId])',
    '@@index([organizationId, status, unitId])',
    '@@map("rental_unit_operational_states")',
  ]) {
    assert.match(operationalSchema, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(rentalSchema, /operationalState\s+RentalUnitOperationalState\?/);
  assert.match(migration, /FOREIGN KEY \("unitId", "organizationId"\)/);
  assert.match(migration, /REFERENCES "rental_units"\("id", "organizationId"\)/);
  assert.match(migration, /rental_unit_operational_states_reason_check/);
});

test('operational input normalization requires reasoned out-of-service transitions and clears stale available reasons', () => {
  assert.match(domain, /status !== 'AVAILABLE' && status !== 'OUT_OF_SERVICE'/);
  assert.match(domain, /status === 'OUT_OF_SERVICE' && !suppliedReason/);
  assert.match(domain, /reason: status === 'OUT_OF_SERVICE' \? suppliedReason : null/);
  assert.match(domainTests, /clears any supplied reason/);
  assert.match(domainTests, /requires and normalizes a reason/);
  assert.match(domainTests, /rejects unsupported status and oversized reasons/);
});

test('operational transitions require inventory authority, tenant scope, serialization, and audit evidence', () => {
  assert.match(service, /requireRentalUnitOperationalPermission\(input, 'inventory:read'\)/);
  assert.match(service, /requireRentalUnitOperationalPermission\(input, 'inventory:manage'\)/);
  assert.match(service, /assertUuidIdentifier\(input\.unitId, 'unitId'\)/);
  assert.match(service, /rentalUnitLockKey\(input\.organizationId, input\.unitId\)/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /SELECT clock_timestamp\(\) AS "now"/);
  assert.match(service, /currentStatus === input\.operational\.status && currentReason === input\.operational\.reason/);
  assert.match(service, /inventory\.rental-unit\.operational-status-changed/);
  assert.match(migration, /NEW\."changedAt" := clock_timestamp\(\)/);
  assert.match(migration, /operational-state identity is immutable/);
  assert.match(migration, /operational-state rows cannot be deleted/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON "rental_unit_operational_states"/);
});

test('out-of-service state is consumed by availability and protected at database write boundaries', () => {
  assert.match(availability, /operationalState: \{ is: null \}/);
  assert.match(availability, /operationalState: \{ is: \{ status: 'AVAILABLE' as const \} \}/);

  for (const trigger of [
    'rental_availability_holds_operational_availability_guard',
    'rental_bookings_operational_availability_guard',
    'rental_booking_allocations_operational_availability_guard',
    'rental_booking_unit_substitutions_operational_availability_guard',
    'rental_booking_reschedules_operational_availability_guard',
    'rental_booking_fulfillment_operational_availability_guard',
  ]) {
    assert.match(migration, new RegExp(trigger));
  }

  assert.match(migration, /NEW\."kind" = 'PICKED_UP'/);
  assert.doesNotMatch(migration, /NEW\."kind" = 'RETURNED'[\s\S]*sf_assert_rental_unit_operationally_available/);
});

test('staff unit controls expose real operational state and retain current operational dependencies', () => {
  assert.match(route, /setRentalUnitOperationalStatus/);
  assert.match(route, /inventory\.rental-unit\.operational-status/);
  assert.match(page, /readRentalUnitOperationalState/);
  assert.match(page, /Operational status/);
  assert.match(page, /OUT_OF_SERVICE/);
  assert.match(page, /Existing bookings are not cancelled automatically/);
  assert.match(docs, /Rental maintenance work orders use this operational state/i);
  assert.match(docs, /unresolved damage case/i);
  assert.match(docs, /database guards deliberately do \*\*not\*\* reject `RETURNED`/);
  assert.match(docs, /GitHub Actions are not required or used/);
});
