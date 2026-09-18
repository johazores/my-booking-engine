import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const domain = readFileSync('src/server/bookings/rental-booking-cancellation-domain.ts', 'utf8');
const service = readFileSync('src/server/bookings/rental-booking-cancellation-service.ts', 'utf8');
const route = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/cancel/route.ts', 'utf8');
const action = readFileSync('src/components/rental-booking-cancel-action.tsx', 'utf8');
const lifecycleMigration = readFileSync('prisma/migrations/20260915142000_rental_booking_cancellation_lifecycle/migration.sql', 'utf8');
const substitutionMigration = readFileSync('prisma/migrations/20260915232000_rental_booking_unit_substitution_lifecycle/migration.sql', 'utf8');

test('rental cancellation requires booking and availability authority and serializes with current effective inventory', () => {
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /permission: 'availability:manage'/);
  assert.match(service, /rentalBookingLockKey/);
  assert.match(service, /rentalBookingUnitSubstitution\.findFirst/);
  assert.match(service, /effectiveUnitId = latestSubstitutionLocator\?\.targetUnitId \?\? bookingLocator\.unitId/);
  assert.match(service, /rentalUnitLockKey\(input\.organizationId, effectiveUnitId\)/);
  assert.match(service, /SELECT clock_timestamp\(\) AS "now"/);
  assert.match(service, /where: \{ id: input\.bookingId, organizationId: input\.organizationId/);
  assert.match(service, /include: \{ allocation: true \}/);
  assert.match(service, /booking\.allocation\.unitId !== currentUnitId/);
  assert.match(service, /rentalBookingReschedule\.findFirst/);
  assert.match(service, /effectiveStartsOn/);
  assert.match(service, /effectiveEndsOn/);
  assert.match(service, /latestUnitSubstitutionId/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /classifyRentalBookingWriteError\(error\)/);
  assert.match(service, /disposition === 'RETRYABLE' && attempt < 2/);
  assert.match(service, /Rental booking cancellation could not be serialized after bounded retries/);
  assert.match(service, /disposition === 'CONFLICT'/);
});

test('final cancellation write is an exact tenant-owned compare-and-swap and retains audit evidence', () => {
  assert.match(service, /rentalBooking\.updateMany\(\{/);
  for (const token of [
    'id: booking.id',
    'organizationId: input.organizationId',
    "status: 'CONFIRMED'",
    'cancelledAt: null',
    'updatedAt: booking.updatedAt',
    'customerId: booking.customerId',
    'holdId: booking.holdId',
    'unitId: booking.unitId',
    'unitTypeId: booking.unitTypeId',
    'locationId: booking.locationId',
    'startsOn: booking.startsOn',
    'endsOn: booking.endsOn',
    'currency: booking.currency',
    'totalMinor: booking.totalMinor',
    'pricingFingerprint: booking.pricingFingerprint',
    'authorityFingerprint: booking.authorityFingerprint',
    "status: 'CANCELLED'",
    'cancelledAt: databaseClock.now',
    "action: 'booking.rental.cancelled'",
    'latestRescheduleId',
    'latestUnitSubstitutionId',
    'cancellationReason',
    'inventoryProtectionReleased: true',
  ]) assert.ok(service.includes(token), `missing cancellation write-scope token: ${token}`);
  assert.match(service, /cancelled\.count !== 1/);
  assert.match(service, /booking\.status === 'CANCELLED'/);
  assert.match(service, /idempotent: true/);
});

test('cancellation reason is required, normalized, bounded, and retained as staff-route audit evidence', () => {
  assert.match(domain, /RENTAL_BOOKING_CANCELLATION_REASON_MAX_LENGTH = 1000/);
  assert.match(domain, /value\.trim\(\)\.replace\(\/\\s\+\/g, ' '\)/);
  assert.match(domain, /reason is required/);
  assert.match(domain, /reason is too long/);
  assert.match(service, /normalizeRentalBookingCancellationReason\(input\.reason\)/);
  assert.match(service, /cancellationReason,/);

  assert.match(route, /readInventoryFormData\(request\)/);
  assert.match(route, /formField\(formData, 'reason'\)/);
  assert.match(route, /reason,/);
  assert.doesNotMatch(route, /formField\(formData, '(organizationId|actorUserId|unitId|startsOn|endsOn|currency|amount)'\)/);

  assert.match(action, /Cancellation reason/);
  assert.match(action, /name="reason"/);
  assert.match(action, /maxLength=\{1000\}/);
  assert.match(action, /required/);
  assert.match(action, /durable audit evidence/i);
});

test('database lifecycle guard makes cancellation terminal and later migration locks current effective unit', () => {
  assert.match(lifecycleMigration, /rental_bookings_cancelled_after_confirmed_check/);
  assert.match(lifecycleMigration, /OLD\."status" = 'CONFIRMED'/);
  assert.match(lifecycleMigration, /NEW\."status" = 'CANCELLED'/);
  assert.match(lifecycleMigration, /unsupported rental booking lifecycle transition/);
  assert.match(lifecycleMigration, /BEFORE UPDATE OF "status", "cancelledAt"/);
  assert.match(substitutionMigration, /CREATE OR REPLACE FUNCTION sf_guard_rental_booking_lifecycle_transition/);
  assert.match(substitutionMigration, /expected_unit_id := sf_rental_booking_effective_unit_id/);
  assert.match(substitutionMigration, /'sf:rental-unit:' \|\| OLD\."organizationId"::text \|\| ':' \|\| expected_unit_id::text/);
});

test('staff route and UI expose explicit cancellation without accepting tenant or commercial authority from the browser', () => {
  assert.match(route, /prepareInventoryMutationRequest\(request, 'booking\.rental\.cancel'\)/);
  assert.match(route, /organizationId: organization\.id/);
  assert.match(route, /actorUserId: session\.user\.id/);
  assert.match(route, /bookingId/);
  assert.match(action, /Cancel rental booking/);
  assert.match(action, /Confirm cancellation/);
  assert.match(action, /does not collect, refund, or change money/i);
  assert.match(action, /method="post"/);
});
