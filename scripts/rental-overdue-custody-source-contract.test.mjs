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
