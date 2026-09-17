import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('availability excludes overdue unreturned physical custody', async () => {
  const source = await read('src/server/inventory/rental-availability-service.ts');
  assert.match(source, /findOverdueRentalCustodyUnitIds/);
  assert.match(source, /id:\s*\{\s*notIn:\s*overdueCustodyUnitIds/);
});

test('stale hold and confirmation authority fail closed on overdue custody', async () => {
  const hold = await read('src/server/inventory/rental-hold-service.ts');
  const review = await read('src/server/bookings/rental-booking-authority-service.ts');
  const confirmation = await read('src/server/bookings/rental-booking-service.ts');
  for (const source of [hold, review, confirmation]) {
    assert.match(source, /findOverdueRentalCustodyUnitIds/);
  }
});

test('reschedule and unit substitution reviews do not advertise overdue inventory', async () => {
  const reschedule = await read('src/server/bookings/rental-booking-reschedule-authority-service.ts');
  const substitution = await read('src/server/bookings/rental-booking-unit-substitution-authority-service.ts');
  assert.match(reschedule, /findOverdueRentalCustodyUnitIds/);
  assert.match(reschedule, /excludeBookingId: booking\.id/);
  assert.match(reschedule, /CUSTODY_EXTENSION/);
  assert.match(substitution, /findOverdueRentalCustodyUnitIds/);
  assert.match(substitution, /fulfillmentEvents:\s*\{\s*none:/);
});

test('database guards protect holds allocations and substitution targets', async () => {
  const migration = await read('prisma/migrations/20260916033000_rental_overdue_custody_availability/migration.sql');
  assert.match(migration, /sf_rental_unit_has_overdue_custody/);
  assert.match(migration, /rental_availability_holds_overdue_custody_guard/);
  assert.match(migration, /rental_booking_allocations_overdue_custody_guard/);
  assert.match(migration, /rental_booking_unit_substitutions_overdue_custody_guard/);
  assert.match(migration, /AT TIME ZONE location\."timeZone"/);
});

test('staff booking reads and UI surface overdue custody without inventing commercial policy', async () => {
  const custodyReadDomain = await read('src/server/bookings/rental-booking-custody-read-domain.ts');
  const readService = await read('src/server/bookings/rental-booking-read-service.ts');
  const listPage = await read('app/inventory/rentals/bookings/page.tsx');
  const detailPage = await read('app/inventory/rentals/bookings/[booking-id]/page.tsx');
  const documentation = await read('docs/rental-overdue-custody-availability.md');

  assert.match(custodyReadDomain, /rentalCustodyIsOverdue/);
  assert.match(custodyReadDomain, /fulfillmentState !== 'PICKED_UP'/);
  assert.match(custodyReadDomain, /bookingStatus !== 'CONFIRMED'/);
  assert.match(readService, /clock_timestamp\(\)/);
  assert.match(readService, /deriveRentalBookingCustodyReadState/);
  assert.match(readService, /select:\s*\{\s*kind:\s*true,\s*occurredAt:\s*true,\s*endsOn:\s*true\s*\}/);
  assert.match(listPage, /Overdue custody/);
  assert.match(detailPage, /OVERDUE CUSTODY/);
  assert.match(detailPage, /does not create a fee or change the committed rental period/);
  assert.match(detailPage, /supported extension is applied/);
  assert.match(documentation, /Staff operational visibility/);
  assert.match(documentation, /same-unit, current-start, later-end price-neutral custody extension/i);
  assert.match(documentation, /Price-changing or broader extensions remain a separate commercial amendment contract/i);
});
