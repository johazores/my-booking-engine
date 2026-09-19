import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const fulfillmentService = read('src/server/bookings/rental-booking-fulfillment-service.ts');
const guardReadService = read('src/server/bookings/rental-booking-pickup-commercial-guard-service.ts');
const migration = read('prisma/migrations/20260919143000-rental-pickup-prepared-amendment-guard/migration.sql');
const bookingDetail = read('app/inventory/rentals/bookings/[booking-id]/page.tsx');
const docs = read('docs/rental-prepared-amendment-pickup-guard.md');

test('fresh pickup fails closed under the booking lock while a commercial amendment is prepared', () => {
  const preparedRead = fulfillmentService.indexOf('transaction.rentalBookingCommercialAmendment.findFirst');
  const eventCreate = fulfillmentService.indexOf('transaction.rentalBookingFulfillmentEvent.create');
  assert.ok(preparedRead >= 0, 'prepared amendment lookup missing from fulfillment writer');
  assert.ok(eventCreate > preparedRead, 'prepared amendment lookup must happen before new custody evidence');
  assert.match(fulfillmentService, /status: 'PREPARED'/);
  assert.match(fulfillmentService, /input\.kind === 'PICKED_UP' && preparedCommercialAmendment/);
  assert.match(fulfillmentService, /Finish, compensate, or close the prepared rental commercial amendment before recording pickup/);
});

test('PostgreSQL independently rejects direct pickup while prepared commercial authority exists', () => {
  assert.match(migration, /sf_guard_rental_booking_pickup_prepared_amendment/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /rental_booking_commercial_amendments/);
  assert.match(migration, /amendment\."status" = 'PREPARED'/);
  assert.match(migration, /WHEN \(NEW\."kind" = 'PICKED_UP'\)/);
  assert.match(migration, /ERRCODE = '23514'/);
});

test('staff pickup UI reads tenant-scoped blocker authority and removes the dead primary action', () => {
  assert.match(guardReadService, /permission: 'booking:read'/);
  assert.match(guardReadService, /organizationId: input\.organizationId/);
  assert.match(guardReadService, /bookingId: input\.bookingId/);
  assert.match(guardReadService, /status: 'PREPARED'/);
  assert.match(bookingDetail, /readRentalBookingPickupCommercialGuard/);
  assert.match(bookingDetail, /&& !pickupCommercialGuard\.blocked/);
  assert.match(bookingDetail, /Pickup is paused while a commercial date amendment is prepared/);
  assert.match(bookingDetail, /Review commercial amendment/);
});

test('documentation states the custody and commercial ownership boundary', () => {
  assert.match(docs, /A `PREPARED` `RentalBookingCommercialAmendment` blocks a new `PICKED_UP`/);
  assert.match(docs, /Return remains recordable/);
  assert.match(docs, /UI read is not the security boundary/);
  assert.match(docs, /does not block `RETURNED` custody evidence/);
});
