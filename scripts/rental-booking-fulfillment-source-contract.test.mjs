import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const schema = read('prisma/rental-booking-fulfillment.prisma');
const inventorySchema = read('prisma/rental-inventory.prisma');
const migration = read('prisma/migrations/20260916024500_rental_booking_fulfillment_foundation/migration.sql');
const service = read('src/server/bookings/rental-booking-fulfillment-service.ts');
const readService = read('src/server/bookings/rental-booking-read-service.ts');
const pickupRoute = read('app/api/inventory/rentals/bookings/[booking-id]/pickup/route.ts');
const returnRoute = read('app/api/inventory/rentals/bookings/[booking-id]/return/route.ts');
const detail = read('app/inventory/rentals/bookings/[booking-id]/page.tsx');

test('fulfillment evidence is append-only, tenant-owned, ordered, and Prisma/database relations stay aligned', () => {
  for (const token of [
    'model RentalBookingFulfillmentEvent {',
    'PICKED_UP',
    'RETURNED',
    'rental_booking_fulfillment_events_org_booking_kind_key',
    'rental_booking_fulfillment_events_booking_fkey',
    'rental_booking_fulfillment_events_unit_fkey',
    'sf_guard_rental_booking_fulfillment_insert',
    'sf_guard_rental_booking_fulfillment_append_only',
  ]) assert.ok(`${schema}\n${migration}`.includes(token), token);
  assert.match(schema, /booking RentalBooking @relation\(fields: \[bookingId, organizationId\], references: \[id, organizationId\].*map: "rental_booking_fulfillment_events_booking_fkey"\)/);
  assert.match(schema, /unit\s+RentalUnit\s+@relation\("RentalBookingFulfillmentEventUnit", fields: \[unitId, organizationId\], references: \[id, organizationId\].*map: "rental_booking_fulfillment_events_unit_fkey"\)/);
  assert.match(inventorySchema, /fulfillmentEvents\s+RentalBookingFulfillmentEvent\[\]\s+@relation\("RentalBookingFulfillmentEventUnit"\)/);
  assert.match(inventorySchema, /fulfillmentEvents\s+RentalBookingFulfillmentEvent\[\]/);
});

test('fulfillment writer derives tenant, custody snapshot, locks, time, idempotency, and permissions server-side', () => {
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /permission: 'inventory:manage'/);
  assert.match(service, /rentalBookingLockKey\(input\.organizationId, input\.bookingId\)/);
  assert.match(service, /rentalUnitLockKey\(input\.organizationId, effectiveUnitId\)/);
  assert.match(service, /clock_timestamp\(\)/);
  assert.match(service, /rentalBookingFulfillmentIdempotencyKey\(input\.bookingId, input\.kind\)/);
  assert.match(service, /booking\.allocation\.unitId !== effectiveUnitId/);
  assert.match(service, /booking\.rental\.picked-up/);
  assert.match(service, /booking\.rental\.returned/);
});

test('idempotent fulfillment replay re-derives and validates the retained physical assignment', () => {
  assert.match(service, /if \(existing\)/);
  assert.match(service, /latestReschedule/);
  assert.match(service, /latestSubstitution/);
  assert.match(service, /existing\.unitId !== effectiveUnitId/);
  assert.match(service, /sameDate\(existing\.startsOn, effectiveStartsOn\)/);
  assert.match(service, /sameDate\(existing\.endsOn, effectiveEndsOn\)/);
  assert.match(service, /history\.some\(\(event\) => event\.id === existing\.id && event\.kind === input\.kind\)/);
  assert.match(service, /Existing rental fulfillment evidence no longer matches the retained physical assignment/);
});

test('pickup freezes unsafe neighboring booking mutations at the database boundary', () => {
  assert.match(migration, /rental_booking_reschedules_pre_fulfillment_guard/);
  assert.match(migration, /rental_booking_unit_substitutions_pre_fulfillment_guard/);
  assert.match(migration, /rental_bookings_cancellation_pre_fulfillment_guard/);
  assert.match(migration, /cannot be cancelled, rescheduled, or reassigned after pickup/);
});

test('staff routes accept no browser-controlled tenant, actor, time, unit, dates, or idempotency authority', () => {
  for (const route of [pickupRoute, returnRoute]) {
    assert.match(route, /organizationId: organization\.id/);
    assert.match(route, /actorUserId: session\.user\.id/);
    assert.doesNotMatch(route, /request\.json\(|request\.formData\(/);
  }
  assert.match(readService, /rentalBookingFulfillmentEvent\.findMany/);
  assert.match(readService, /deriveRentalBookingFulfillmentState\(fulfillmentEvents\)/);
  assert.match(detail, /Record pickup/);
  assert.match(detail, /Record return/);
  assert.match(detail, /beforePickup/);
  assert.match(detail, /Return does not release inventory before the booking's effective end date/);
});
