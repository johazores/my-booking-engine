import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('src/server/bookings/rental-booking-cancellation-service.ts', 'utf8');
const route = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/cancel/route.ts', 'utf8');
const action = readFileSync('src/components/rental-booking-cancel-action.tsx', 'utf8');
const lifecycleMigration = readFileSync('prisma/migrations/20260915142000_rental_booking_cancellation_lifecycle/migration.sql', 'utf8');

test('rental cancellation requires booking and availability authority and serializes with physical inventory', () => {
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /permission: 'availability:manage'/);
  assert.match(service, /rentalBookingLockKey/);
  assert.match(service, /rentalUnitLockKey\(input\.organizationId, locator\.unitId\)/);
  assert.match(service, /SELECT clock_timestamp\(\) AS "now"/);
  assert.match(service, /where: \{ id: input\.bookingId, organizationId: input\.organizationId/);
  assert.match(service, /include: \{ allocation: true \}/);
  assert.match(service, /allocation\.unitId !== booking\.unitId/);
  assert.match(service, /rentalBookingReschedule\.findFirst/);
  assert.match(service, /effectiveStartsOn/);
  assert.match(service, /effectiveEndsOn/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /prismaErrorCode\(error\) === 'P2034'/);
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
    'inventoryProtectionReleased: true',
  ]) {
    assert.ok(service.includes(token), `missing cancellation write-scope token: ${token}`);
  }
  assert.match(service, /cancelled\.count !== 1/);
  assert.match(service, /booking\.status === 'CANCELLED'/);
  assert.match(service, /idempotent: true/);
});

test('database lifecycle guard makes cancellation terminal and uses the shared rental-unit lock', () => {
  assert.match(lifecycleMigration, /rental_bookings_cancelled_after_confirmed_check/);
  assert.match(lifecycleMigration, /sf_guard_rental_booking_lifecycle_transition/);
  assert.match(lifecycleMigration, /'sf:rental-unit:' \|\| OLD\."organizationId"::text \|\| ':' \|\| OLD\."unitId"::text/);
  assert.match(lifecycleMigration, /OLD\."status" = 'CONFIRMED'/);
  assert.match(lifecycleMigration, /NEW\."status" = 'CANCELLED'/);
  assert.match(lifecycleMigration, /unsupported rental booking lifecycle transition/);
  assert.match(lifecycleMigration, /BEFORE UPDATE OF "status", "cancelledAt"/);
});

test('staff route and UI expose explicit cancellation without accepting tenant or commercial authority from the browser', () => {
  assert.match(route, /prepareInventoryMutationRequest\(request, 'booking\.rental\.cancel'\)/);
  assert.match(route, /organizationId: organization\.id/);
  assert.match(route, /actorUserId: session\.user\.id/);
  assert.match(route, /bookingId/);
  assert.doesNotMatch(route, /formData|formField/);
  assert.match(action, /Cancel rental booking/);
  assert.match(action, /Confirm cancellation/);
  assert.match(action, /does not collect, refund, or change money/i);
  assert.match(action, /method="post"/);
});
