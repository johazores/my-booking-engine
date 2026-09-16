import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('overdue custody queue uses tenant-scoped PostgreSQL authority before pagination', async () => {
  const service = await read('src/server/bookings/rental-booking-read-service.ts');

  assert.match(service, /RentalBookingListCustody = 'ALL' \| 'OVERDUE'/);
  assert.match(service, /readOverdueRentalBookingCount/);
  assert.match(service, /readOverdueRentalBookingPageIds/);
  assert.match(service, /COUNT\(\*\)::text AS "total"/);
  assert.match(service, /booking\."organizationId" = \$\{input\.organizationId\}::uuid/);
  assert.match(service, /location\."organizationId" = \$\{input\.organizationId\}::uuid/);
  assert.match(service, /pickup\."organizationId" = \$\{input\.organizationId\}::uuid/);
  assert.match(service, /returned\."organizationId" = \$\{input\.organizationId\}::uuid/);
  assert.match(service, /booking\."status" = 'CONFIRMED'/);
  assert.match(service, /AT TIME ZONE location\."timeZone"/);
  assert.match(service, /returned\."kind" = 'RETURNED'/);
  assert.match(service, /ORDER BY booking\."createdAt" DESC, booking\."id" DESC[\s\S]*OFFSET \$\{input\.offset\}[\s\S]*LIMIT \$\{input\.limit\}/);
  assert.match(service, /where: \{ organizationId: input\.organizationId, id: \{ in: bookingIds \} \}/);
});

test('overdue custody queue stays in the booking read snapshot and final rows keep derived custody checks', async () => {
  const service = await read('src/server/bookings/rental-booking-read-service.ts');
  const listStart = service.indexOf('export async function listRentalBookings');
  const clockIndex = service.indexOf('SELECT clock_timestamp() AS "now"', listStart);
  const overdueCountIndex = service.indexOf('readOverdueRentalBookingCount(transaction', clockIndex);
  const overduePageIndex = service.indexOf('readOverdueRentalBookingPageIds(transaction', overdueCountIndex);
  const pageReadIndex = service.indexOf('transaction.rentalBooking.findMany({', overduePageIndex);
  const derivedCustodyIndex = service.indexOf('deriveRentalBookingCustodyReadState({', pageReadIndex);
  const repeatableReadIndex = service.indexOf("isolationLevel: 'RepeatableRead'", derivedCustodyIndex);

  assert.ok(listStart >= 0);
  assert.ok(clockIndex > listStart);
  assert.ok(overdueCountIndex > clockIndex);
  assert.ok(overduePageIndex > overdueCountIndex);
  assert.ok(pageReadIndex > overduePageIndex);
  assert.ok(derivedCustodyIndex > pageReadIndex);
  assert.ok(repeatableReadIndex > derivedCustodyIndex);
  assert.match(service, /if \(custody === 'OVERDUE'\)/);
  assert.match(service, /total = status === 'CANCELLED' \? 0 : overdueCount/);
  assert.match(service, /overdueCount,/);
  assert.match(service, /bookingRows\.length !== bookingIds\.length/);
  assert.match(service, /bookings\.some\(\(booking\) => !booking\.custody\.overdue\)/);
  assert.match(service, /queue disagreed with retained booking custody evidence/);
});

test('staff list exposes a real overdue queue without inventing late-return commerce', async () => {
  const listPage = await read('app/inventory/rentals/bookings/page.tsx');
  const custodyDoc = await read('docs/rental-overdue-custody-availability.md');
  const readDoc = await read('docs/rental-booking-read-consistency.md');

  assert.match(listPage, /name="custody"/);
  assert.match(listPage, /Overdue only/);
  assert.match(listPage, /Review \{result\.overdueCount\} overdue custody/);
  assert.match(listPage, /custody: 'OVERDUE'/);
  assert.match(listPage, /No overdue rental custody matches this filter/);
  assert.match(listPage, /recording return remains the custody-closing action/);

  assert.match(custodyDoc, /filtered in PostgreSQL before pagination/);
  assert.match(custodyDoc, /Booking, location, pickup, and return predicates all repeat `organizationId`/);
  assert.match(custodyDoc, /queue is read-only/);
  assert.match(custodyDoc, /does \*\*not\*\* implement rental extensions, grace periods, late fees/);

  assert.match(readDoc, /overdue booking IDs in PostgreSQL before final page loading/);
  assert.match(readDoc, /An overdue queue is inherently confirmed custody/);
  assert.match(readDoc, /SQL\/domain disagreement fails closed/);
  assert.match(readDoc, /do not mutate booking status, extend the rental, calculate a late fee/);
  assert.match(readDoc, /GitHub Actions are not required or used/);
});
