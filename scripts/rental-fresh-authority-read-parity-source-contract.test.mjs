import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const availability = readFileSync('src/server/inventory/rental-availability-service.ts', 'utf8');
const conversionAuthority = readFileSync('src/server/bookings/rental-booking-authority-service.ts', 'utf8');
const readinessMigration = readFileSync(
  'prisma/migrations/20260920043000-rental-non-clear-return-readiness-authority/migration.sql',
  'utf8',
);
const authorityDocs = readFileSync('docs/rental-booking-authority.md', 'utf8');

test('availability discovery excludes unresolved returned-unit readiness evidence', () => {
  assert.match(availability, /fulfillmentEvents:\s*\{[\s\S]*none:\s*\{[\s\S]*kind: 'RETURNED'[\s\S]*returnInspection: \{ is: null \}/);
  assert.match(availability, /returnInspections:\s*\{[\s\S]*none:\s*\{[\s\S]*outcome: \{ in: \['DAMAGE_REPORTED' as const, 'UNSAFE' as const\] \}/);
  assert.match(availability, /damageCase: \{ is: null \}/);
  assert.match(availability, /status: \{ in: \['OPEN' as const, 'ASSESSED' as const\] \}/);
  assert.match(availability, /operationalState: \{ is: null \}/);
  assert.match(availability, /operationalState: \{ is: \{ status: 'AVAILABLE' as const \} \}/);
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

test('application read readiness mirrors the PostgreSQL fresh-rental authority evidence families', () => {
  assert.match(readinessMigration, /rental_unit_operational_states/);
  assert.match(readinessMigration, /"status" = 'OUT_OF_SERVICE'/);
  assert.match(readinessMigration, /rental_booking_fulfillment_events/);
  assert.match(readinessMigration, /return_event\."kind" = 'RETURNED'/);
  assert.match(readinessMigration, /rental_return_inspections/);
  assert.match(readinessMigration, /inspection\."outcome" IN \('DAMAGE_REPORTED', 'UNSAFE'\)/);
  assert.match(readinessMigration, /damage_case\."status" IN \('WAIVED', 'CLOSED'\)/);
  assert.match(authorityDocs, /physical-unit readiness evidence that also feeds PostgreSQL fresh-rental authority/);
  assert.match(authorityDocs, /never produces an authority fingerprint for a unit that PostgreSQL would already reject/);
});
