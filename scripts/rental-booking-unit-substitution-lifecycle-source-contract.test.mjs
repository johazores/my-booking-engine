import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const model = read('prisma/rental-booking-unit-substitution.prisma');
const rentalSchema = read('prisma/rental-inventory.prisma');
const migration = read('prisma/migrations/20260915232000_rental_booking_unit_substitution_lifecycle/migration.sql');
const domain = read('src/server/bookings/rental-booking-unit-substitution-domain.ts');
const authority = read('src/server/bookings/rental-booking-unit-substitution-authority-service.ts');
const writer = read('src/server/bookings/rental-booking-unit-substitution-service.ts');
const cancellation = read('src/server/bookings/rental-booking-cancellation-service.ts');
const rescheduleAuthority = read('src/server/bookings/rental-booking-reschedule-authority-service.ts');
const rescheduleWriter = read('src/server/bookings/rental-booking-reschedule-service.ts');
const readService = read('src/server/bookings/rental-booking-read-service.ts');
const route = read('app/api/inventory/rentals/bookings/[booking-id]/unit-substitution/route.ts');

test('substitution evidence is tenant-scoped, append-only, and linked to source and target units', () => {
  for (const token of [
    'model RentalBookingUnitSubstitution',
    '@@unique([organizationId, idempotencyKey]',
    'RentalBookingUnitSubstitutionSourceUnit',
    'RentalBookingUnitSubstitutionTargetUnit',
    'unitSubstitutions RentalBookingUnitSubstitution[]',
  ]) assert.ok(model.includes(token) || rentalSchema.includes(token), token);
  for (const token of [
    'rental_booking_unit_substitutions_booking_fkey',
    'rental_booking_unit_substitutions_source_unit_fkey',
    'rental_booking_unit_substitutions_target_unit_fkey',
    'sf_guard_rental_booking_unit_substitution_insert',
    'sf_guard_rental_booking_unit_substitution_append_only',
    'rental_booking_unit_substitutions_require_allocation_guard',
    'DEFERRABLE INITIALLY DEFERRED',
  ]) assert.ok(migration.includes(token), token);
});

test('database authority derives current unit from substitution history and protects inventory mutations', () => {
  for (const token of [
    'sf_rental_booking_effective_unit_id',
    'ORDER BY substitution."appliedAt" DESC',
    'sf_guard_rental_booking_allocation',
    'sf_guard_rental_booking_requires_allocation',
    'sf_guard_rental_booking_reschedule_insert',
    'sf_guard_rental_booking_reschedule_requires_allocation',
    'sf_guard_rental_booking_lifecycle_transition',
    'sf_guard_rental_unit_active_booking_assignment',
    'rental unit with an active booking allocation cannot be archived, relocated, or retyped',
  ]) assert.ok(migration.includes(token), token);
  assert.match(migration, /ORDER BY unit_id::text/);
});

test('writer enforces server authorization, deterministic dual-unit serialization, stale authority, and idempotent current-state replay', () => {
  for (const permission of ['booking:manage', 'availability:read', 'availability:manage', 'inventory:read']) {
    assert.ok(writer.includes(`permission: '${permission}'`), permission);
  }
  for (const token of [
    'rentalBookingLockKey',
    'rentalUnitLockKey',
    '.sort((left, right) => left.localeCompare(right))',
    'clock_timestamp()',
    "isolationLevel: 'Serializable'",
    'rentalBookingUnitSubstitution.findFirst',
    'latestSubstitution.id !== existing.id',
    'allocation.unitId !== existing.targetUnitId',
    'buildRentalBookingUnitSubstitutionAuthorityFingerprint',
    'rentalBookingAllocation.updateMany',
    "action: 'booking.rental.unit-substituted'",
    'classifyRentalBookingWriteError',
  ]) assert.ok(writer.includes(token), token);
  assert.match(domain, /rental-unit-substitution:\$\{digest\}/);
});

test('all neighboring booking flows follow the effective substituted allocation rather than immutable booking-time unit', () => {
  for (const source of [authority, cancellation, rescheduleAuthority, rescheduleWriter]) {
    assert.ok(source.includes('rentalBookingUnitSubstitution'), 'latest substitution lookup missing');
    assert.ok(source.includes('targetUnitId'), 'effective target unit missing');
  }
  assert.ok(readService.includes('unitSubstitutions'));
  assert.ok(readService.includes('allocation: { include: effectiveAllocationInclude }'));
});

test('staff mutation route derives tenant actor and idempotency authority server-side', () => {
  for (const token of [
    "prepareInventoryMutationRequest(request, 'booking.rental.unit-substitute')",
    'organizationId: organization.id',
    'actorUserId: session.user.id',
    'buildRentalBookingUnitSubstitutionIdempotencyKey',
    'applyRentalBookingUnitSubstitution',
    'authorityFingerprint',
    'targetUnitId',
  ]) assert.ok(route.includes(token), token);
  assert.doesNotMatch(route, /formField\(formData, 'organizationId'\)/);
  assert.doesNotMatch(route, /formField\(formData, 'actorUserId'\)/);
  assert.doesNotMatch(route, /formField\(formData, 'idempotencyKey'\)/);
});
