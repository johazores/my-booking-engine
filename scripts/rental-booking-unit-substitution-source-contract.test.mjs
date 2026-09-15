import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('prisma/rental-booking-unit-substitution.prisma', 'utf8');
const rentalSchema = readFileSync('prisma/rental-inventory.prisma', 'utf8');
const migration = readFileSync('prisma/migrations/20260916033000_rental_booking_unit_substitution_lifecycle/migration.sql', 'utf8');
const domain = readFileSync('src/server/bookings/rental-booking-unit-substitution-domain.ts', 'utf8');
const authority = readFileSync('src/server/bookings/rental-booking-unit-substitution-authority-service.ts', 'utf8');
const writer = readFileSync('src/server/bookings/rental-booking-unit-substitution-service.ts', 'utf8');
const rescheduleReview = readFileSync('src/server/bookings/rental-booking-reschedule-authority-service.ts', 'utf8');
const rescheduleWriter = readFileSync('src/server/bookings/rental-booking-reschedule-service.ts', 'utf8');
const cancellation = readFileSync('src/server/bookings/rental-booking-cancellation-service.ts', 'utf8');
const readService = readFileSync('src/server/bookings/rental-booking-read-service.ts', 'utf8');
const route = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/substitute-unit/route.ts', 'utf8');
const page = readFileSync('app/inventory/rentals/bookings/[booking-id]/substitute-unit/page.tsx', 'utf8');
const detail = readFileSync('app/inventory/rentals/bookings/[booking-id]/page.tsx', 'utf8');
const list = readFileSync('app/inventory/rentals/bookings/page.tsx', 'utf8');
const docs = readFileSync('docs/rental-booking-unit-substitution-lifecycle.md', 'utf8');

test('unit substitution evidence is tenant-owned, append-only, and drives effective allocation', () => {
  for (const token of [
    'model RentalBookingUnitSubstitution',
    '@@unique([organizationId, idempotencyKey]',
    '@@index([organizationId, bookingId, appliedAt]',
    'sourceUnit',
    'targetUnit',
  ]) assert.ok(schema.includes(token), `missing substitution schema token: ${token}`);
  assert.match(rentalSchema, /unitSubstitutions\s+RentalBookingUnitSubstitution\[\]/);
  assert.match(rentalSchema, /substitutionsFrom\s+RentalBookingUnitSubstitution\[\]/);
  assert.match(rentalSchema, /substitutionsTo\s+RentalBookingUnitSubstitution\[\]/);

  for (const token of [
    'rental_booking_unit_substitutions_booking_fkey',
    'rental_booking_unit_substitutions_source_unit_fkey',
    'rental_booking_unit_substitutions_target_unit_fkey',
    'sf_guard_rental_booking_unit_substitution_insert',
    'sf_guard_rental_booking_unit_substitution_append_only',
    'latest_substitution."targetUnitId"',
    'rental_booking_unit_substitutions_require_allocation_guard',
    'DEFERRABLE INITIALLY DEFERRED',
  ]) assert.ok(migration.includes(token), `missing substitution migration token: ${token}`);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "rental_booking_unit_substitutions"/);
  assert.match(migration, /NEW\."unitId" <> expected_unit_id/);
});

test('review and apply enforce permissions, tenant scope, deterministic source-target locks, and fresh inventory', () => {
  for (const token of [
    "permission: 'booking:manage'",
    "permission: 'availability:read'",
    "permission: 'inventory:read'",
    'organizationId: input.organizationId',
    'take: 100',
    'rentalBookingUnitSubstitution.findFirst',
    'expectedSourceUnitId',
    'expiresAt: { gt: databaseClock.now }',
    'bookingId: { not: booking.id }',
    'buildRentalBookingUnitSubstitutionAuthorityFingerprint({',
  ]) assert.ok(authority.includes(token), `missing authority token: ${token}`);

  for (const token of [
    "permission: 'booking:manage'",
    "permission: 'availability:read'",
    "permission: 'availability:manage'",
    "permission: 'inventory:read'",
    'rentalBookingLockKey(input.organizationId, input.bookingId)',
    '[locator.allocation.unitId, requested.targetUnitId]',
    '[...new Set(unitIds)].sort()',
    'SELECT clock_timestamp() AS "now"',
    "isolationLevel: 'Serializable'",
    'rentalBookingUnitSubstitution.create({',
    'rentalBookingAllocation.updateMany({',
    'data: { unitId: targetUnit.id }',
    'rentalBooking.updateMany({',
    "action: 'booking.rental.unit-substituted'",
  ]) assert.ok(writer.includes(token), `missing writer token: ${token}`);
  assert.match(domain, /version: 1/);
  assert.match(domain, /bookingUpdatedAt:/);
  assert.match(domain, /sourceUnitId:/);
  assert.match(domain, /targetUnitId:/);
  assert.match(domain, /rental-unit-substitution:/);
});

test('writer preserves original booking commercial and unit evidence while moving only effective allocation', () => {
  assert.match(writer, /unitId: booking\.unitId/);
  assert.match(writer, /startsOn: booking\.startsOn/);
  assert.match(writer, /endsOn: booking\.endsOn/);
  assert.match(writer, /currency: booking\.currency/);
  assert.match(writer, /totalMinor: booking\.totalMinor/);
  assert.match(writer, /pricingFingerprint: booking\.pricingFingerprint/);
  assert.match(writer, /data: \{ unitId: targetUnit\.id \}/);
  assert.match(writer, /data: \{ updatedAt: databaseClock\.now \}/);
  assert.match(docs, /original booking-time `RentalBooking\.unitId` never changes/i);
});

test('reschedule and cancellation use effective substituted unit instead of original booking unit', () => {
  for (const source of [rescheduleReview, rescheduleWriter]) {
    assert.match(source, /rentalBookingUnitSubstitution\.findFirst/);
    assert.match(source, /latestSubstitution\?\.targetUnitId \?\? booking\.unitId/);
    assert.match(source, /booking\.allocation\.unitId/);
  }
  assert.match(cancellation, /rentalBookingUnitSubstitution\.findFirst/);
  assert.match(cancellation, /effectiveUnitId = latestSubstitution\?\.targetUnitId \?\? booking\.unitId/);
  assert.match(cancellation, /rentalUnitLockKey\(input\.organizationId, locator\.allocation\.unitId\)/);
  assert.match(migration, /current_unit_id/);
  assert.match(migration, /FROM "rental_booking_allocations" allocation/);
});

test('staff route derives security/idempotency authority server-side and read UI exposes effective plus historical units', () => {
  assert.match(route, /prepareInventoryMutationRequest\(request, 'booking\.rental\.unit-substitute'\)/);
  assert.match(route, /organizationId: organization\.id/);
  assert.match(route, /actorUserId: session\.user\.id/);
  assert.match(route, /buildRentalBookingUnitSubstitutionIdempotencyKey/);
  assert.doesNotMatch(route, /formField\(formData, 'organizationId'\)/);
  assert.doesNotMatch(route, /formField\(formData, 'actorUserId'\)/);
  assert.doesNotMatch(route, /formField\(formData, 'idempotencyKey'\)/);
  assert.match(page, /method="get"/);
  assert.match(page, /Review target unit/);
  assert.match(page, /method="post"/);
  assert.match(page, /Apply unit substitution/);
  assert.match(page, /canApply = canReview && hasPermission\('availability:manage'\)/);
  assert.match(readService, /rentalBookingUnitSubstitution\.findMany/);
  assert.match(readService, /organizationId: input\.organizationId/);
  assert.match(detail, /Original booking-time unit/);
  assert.match(detail, /Physical-unit substitutions/);
  assert.match(list, /booking\.allocation\?\.unit \?\? booking\.unit/);
});

test('supported replacement stays intentionally separate from price-changing and fulfillment workflows', () => {
  assert.match(docs, /same booked unit type/i);
  assert.match(docs, /same booked operating location/i);
  assert.match(docs, /accepted money.*remain immutable/i);
  assert.match(docs, /Price-changing amendments/);
  assert.match(docs, /payment\/deposit consequences/);
  assert.match(docs, /pickup\/delivery\/return/);
  assert.doesNotMatch(page, /Collect payment|Capture deposit|Upgrade unit type|Change operating location/);
});
