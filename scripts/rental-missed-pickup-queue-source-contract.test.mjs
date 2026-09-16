import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('missed pickup queue uses tenant-scoped effective booking authority before pagination', async () => {
  const service = await read('src/server/bookings/rental-booking-read-service.ts');

  assert.match(service, /RentalBookingListCustody = 'ALL' \| 'OVERDUE' \| 'MISSED_PICKUP'/);
  assert.match(service, /readMissedPickupRentalBookingCount/);
  assert.match(service, /readMissedPickupRentalBookingPageIds/);
  assert.match(service, /booking\."organizationId" = \$\{input\.organizationId\}::uuid/);
  assert.match(service, /location\."organizationId" = \$\{input\.organizationId\}::uuid/);
  assert.match(service, /reschedule\."organizationId" = \$\{input\.organizationId\}::uuid/);
  assert.match(service, /fulfillment\."organizationId" = \$\{input\.organizationId\}::uuid/);
  assert.match(service, /booking\."status" = 'CONFIRMED'/);
  assert.match(service, /AT TIME ZONE location\."timeZone"/);
  assert.match(service, /reschedule\."targetEndsOn"/);
  assert.match(service, /ORDER BY reschedule\."appliedAt" DESC, reschedule\."createdAt" DESC, reschedule\."id" DESC/);
  assert.match(service, /COALESCE\([\s\S]*booking\."endsOn"/);
  assert.match(service, /NOT EXISTS \([\s\S]*rental_booking_fulfillment_events/);
  assert.match(service, /ORDER BY booking\."createdAt" DESC, booking\."id" DESC[\s\S]*OFFSET \$\{input\.offset\}[\s\S]*LIMIT \$\{input\.limit\}/);
});

test('missed pickup queue stays in the repeatable-read snapshot and revalidates selected rows', async () => {
  const service = await read('src/server/bookings/rental-booking-read-service.ts');
  const listStart = service.indexOf('export async function listRentalBookings');
  const clockIndex = service.indexOf('SELECT clock_timestamp() AS "now"', listStart);
  const missedCountIndex = service.indexOf('readMissedPickupRentalBookingCount(transaction', clockIndex);
  const missedPageIndex = service.indexOf('readMissedPickupRentalBookingPageIds(transaction', missedCountIndex);
  const pageReadIndex = service.indexOf('transaction.rentalBooking.findMany({', missedPageIndex);
  const derivedPickupIndex = service.indexOf('deriveRentalBookingPickupReadState({', pageReadIndex);
  const agreementIndex = service.indexOf("custody === 'MISSED_PICKUP'", derivedPickupIndex);
  const repeatableReadIndex = service.indexOf("isolationLevel: 'RepeatableRead'", agreementIndex);

  assert.ok(listStart >= 0);
  assert.ok(clockIndex > listStart);
  assert.ok(missedCountIndex > clockIndex);
  assert.ok(missedPageIndex > missedCountIndex);
  assert.ok(pageReadIndex > missedPageIndex);
  assert.ok(derivedPickupIndex > pageReadIndex);
  assert.ok(agreementIndex > derivedPickupIndex);
  assert.ok(repeatableReadIndex > agreementIndex);
  assert.match(service, /total = status === 'CANCELLED' \? 0 : missedPickupCount/);
  assert.match(service, /missedPickupCount,/);
  assert.match(service, /where: \{ organizationId: input\.organizationId, id: \{ in: bookingIds \} \}/);
  assert.match(service, /bookings\.some\(\(booking\) => !booking\.pickup\.missed\)/);
  assert.match(service, /queue disagreed with retained booking pickup-window evidence/);
});

test('staff list exposes missed pickup as read-only operational visibility', async () => {
  const listPage = await read('app/inventory/rentals/bookings/page.tsx');
  const docs = await read('docs/rental-booking-pickup-window.md');
  const readDoc = await read('docs/rental-booking-read-consistency.md');

  assert.match(listPage, /value="missed-pickup">Missed pickup only/);
  assert.match(listPage, /Review \{result\.missedPickupCount\} missed pickup/);
  assert.match(listPage, /custody: 'MISSED_PICKUP'/);
  assert.match(listPage, /booking\.pickup\.missed/);
  assert.match(listPage, /No missed rental pickups match this filter/);
  assert.match(listPage, /does not cancel, reschedule, refund, or extend a booking automatically/);

  assert.match(docs, /selected in PostgreSQL before pagination/i);
  assert.match(docs, /latest supported reschedule end date/i);
  assert.match(docs, /does not create a second mutable booking status/i);
  assert.match(docs, /does not automatically extend a rental/i);
  assert.match(readDoc, /`MISSED_PICKUP` queue is selected in PostgreSQL before pagination/);
  assert.match(readDoc, /no-show policy/);
});
