import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('candidate and review authority close unit substitution after the committed pickup window', async () => {
  const service = await read('src/server/bookings/rental-booking-unit-substitution-authority-service.ts');

  assert.match(service, /deriveRentalBookingPickupWindow/);
  assert.match(service, /timeZone: true/);
  assert.match(service, /pickupWindow\.state === 'CLOSED'/);
  assert.equal((service.match(/assertUnitSubstitutionPickupWindowOpen\(\{/g) ?? []).length, 2);
  assert.match(service, /Reschedule or cancel the booking before changing its physical unit/);
});

test('writer rechecks fulfillment and pickup-window authority under the booking lock', async () => {
  const writer = await read('src/server/bookings/rental-booking-unit-substitution-service.ts');

  assert.match(writer, /deriveRentalBookingPickupWindow/);
  assert.equal((writer.match(/fulfillmentEvents: \{ none: \{ organizationId: input\.organizationId \} \}/g) ?? []).length, 2);
  assert.match(writer, /location: \{ select: \{ id: true, timeZone: true \} \}/);
  assert.match(writer, /observedAt: databaseClock\.now/);
  assert.match(writer, /pickupWindow\.state === 'CLOSED'/);
  assert.match(writer, /pickup window closed before the replacement unit could be applied/);
});

test('database substitution guard uses tenant location time and latest reschedule authority', async () => {
  const migration = await read('prisma/migrations/20260916113000_rental_unit_substitution_pickup_window_guard/migration.sql');

  assert.match(migration, /sf_guard_rental_booking_unit_substitution_pickup_window/);
  assert.match(migration, /location\."organizationId" = NEW\."organizationId"/);
  assert.match(migration, /rental_booking_reschedules/);
  assert.match(migration, /clock_timestamp\(\) AT TIME ZONE parent_booking\."timeZone"/);
  assert.match(migration, /observed_local_date >= expected_ends_on/);
  assert.match(migration, /rental_booking_unit_substitutions_pickup_window_guard/);
});

test('staff surfaces do not offer replacement for missed pickup bookings', async () => {
  const [listPage, detailPage, reviewPage] = await Promise.all([
    read('app/inventory/rentals/bookings/page.tsx'),
    read('app/inventory/rentals/bookings/[booking-id]/page.tsx'),
    read('app/inventory/rentals/bookings/[booking-id]/unit-substitution/page.tsx'),
  ]);

  assert.match(listPage, /!booking\.pickup\.missed && canReviewUnitSubstitution/);
  assert.match(detailPage, /canReviewUnitSubstitutionPermission && pickupWindow\.state !== 'CLOSED'/);
  assert.match(detailPage, /'MISSED PICKUP'/);
  assert.match(detailPage, /Do not hand over or replace the unit under this expired rental period/);
  assert.match(reviewPage, /booking\.fulfillment\.state !== 'AWAITING_PICKUP' \|\| pickupWindow\.state === 'CLOSED'/);
  assert.match(reviewPage, /Replacement window is closed/);
});
