import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('src/server/bookings/rental-booking-read-service.ts', 'utf8');
const history = readFileSync('src/server/bookings/rental-booking-history.ts', 'utf8');
const documentation = readFileSync('docs/rental-booking-read-consistency.md', 'utf8');

test('rental booking append-only detail history is bounded by tenant-scoped cursor pages', () => {
  assert.match(history, /RENTAL_BOOKING_HISTORY_PAGE_SIZE = 100/);
  assert.match(history, /RENTAL_BOOKING_HISTORY_MAX_ROWS = 1_000/);
  assert.match(history, /readPage\(cursorId, RENTAL_BOOKING_HISTORY_PAGE_SIZE\)/);
  assert.match(history, /readPage\(cursorId, 1\)/);
  assert.match(history, /history safety limit/);

  assert.match(service, /readBoundedRentalBookingHistory/);
  assert.match(service, /rentalBookingReschedule\.findMany/);
  assert.match(service, /rentalBookingUnitSubstitution\.findMany/);
  assert.match(service, /where: \{ bookingId: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(service, /cursor: \{ id: cursorId \}/);
  assert.match(service, /orderBy: \{ id: 'asc' \}/);
  assert.match(service, /RentalBookingHistoryUnavailableError/);
});

test('booking detail and list reads use repeatable-read snapshots', () => {
  const repeatableReads = service.match(/isolationLevel: 'RepeatableRead'/g) ?? [];
  assert.equal(repeatableReads.length, 2);
  assert.match(service, /transaction\.rentalBooking\.findFirst/);
  assert.match(service, /transaction\.rentalBooking\.count/);
  assert.match(service, /transaction\.rentalBooking\.findMany/);
});

test('fulfillment history stays bounded without hiding invalid third custody evidence', () => {
  const fulfillmentTakeThree = service.match(/fulfillmentEvents:[\s\S]*?take: 3/g) ?? [];
  assert.ok(fulfillmentTakeThree.length >= 1);
  assert.match(service, /rentalBookingFulfillmentEvent\.findMany\([\s\S]*?take: 3/);
  assert.match(service, /deriveRentalBookingFulfillmentState\(fulfillmentEvents\)/);
});

test('documentation preserves read-only scope and local validation policy', () => {
  assert.match(documentation, /RepeatableRead/);
  assert.match(documentation, /100-row cursor pages/);
  assert.match(documentation, /1,000 rows/);
  assert.match(documentation, /fails closed/);
  assert.match(documentation, /does not create write authority/);
  assert.match(documentation, /GitHub Actions are not required or used/);
});
