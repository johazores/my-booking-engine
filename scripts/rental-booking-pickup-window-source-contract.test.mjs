import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const service = read('src/server/bookings/rental-booking-fulfillment-service.ts');
const detailPage = read('app/inventory/rentals/bookings/[booking-id]/page.tsx');
const pickupRoute = read('app/api/inventory/rentals/bookings/[booking-id]/pickup/route.ts');
const migration = read('prisma/migrations/20260916094500_rental_booking_pickup_window_guard/migration.sql');
const docs = read('docs/rental-booking-pickup-window.md');

test('fulfillment writer uses PostgreSQL time and retained location timezone before pickup', () => {
  assert.match(service, /deriveRentalBookingPickupWindow/);
  assert.match(service, /SELECT clock_timestamp\(\) AS "now"/);
  assert.match(service, /location: \{ select: \{ timeZone: true \} \}/);
  assert.match(service, /input\.kind === 'PICKED_UP'/);
  assert.match(service, /pickupWindow\.state === 'BEFORE_WINDOW'/);
  assert.match(service, /pickupWindow\.state === 'CLOSED'/);
  assert.match(service, /RentalBookingPickupWindowConflictError/);
});

test('pickup route preserves a specific window-conflict UX across a render-submit boundary', () => {
  assert.match(pickupRoute, /RentalBookingPickupWindowConflictError/);
  assert.match(pickupRoute, /return 'pickup-window'/);
  assert.match(detailPage, /'pickup-window':/);
});

test('database guard independently protects the exclusive pickup window', () => {
  assert.match(migration, /sf_guard_rental_booking_pickup_window/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /rental_booking_reschedules/);
  assert.match(migration, /rental_locations/);
  assert.match(migration, /clock_timestamp\(\) AT TIME ZONE retained_location\."timeZone"/);
  assert.match(migration, /pickup_local_date < effective_starts_on/);
  assert.match(migration, /pickup_local_date >= effective_ends_on/);
  assert.match(migration, /WHEN \(NEW\."kind" = 'PICKED_UP'\)/);
});

test('staff detail exposes pickup only while the server-derived committed window is open', () => {
  assert.match(detailPage, /deriveRentalBookingPickupWindow/);
  assert.match(detailPage, /booking\.custody\.observedAt/);
  assert.match(detailPage, /const canRecordPickup = canFulfill/);
  assert.match(detailPage, /pickupWindow\.state === 'OPEN'/);
  assert.match(detailPage, /canRecordPickup \? <form/);
  assert.match(detailPage, /Pickup opens on/);
  assert.match(detailPage, /Pickup window closed/);
});

test('documentation preserves date-based commercial boundaries without inventing fees or extensions', () => {
  assert.match(docs, /exclusive committed end date/i);
  assert.match(docs, /create a late fee/i);
  assert.match(docs, /automatically extend/i);
  assert.match(docs, /PostgreSQL/i);
  assert.match(docs, /location timezone/i);
});
