import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cancellation = readFileSync('src/server/bookings/rental-booking-cancellation-service.ts', 'utf8');
const reschedule = readFileSync('src/server/bookings/rental-booking-reschedule-service.ts', 'utf8');
const custodyMigration = readFileSync('prisma/migrations/20260917102000_rental_booking_custody_extension/migration.sql', 'utf8');
const docs = readFileSync('docs/rental-booking-fulfillment-foundation.md', 'utf8');

test('cancellation rechecks tenant-owned custody evidence inside the booking lock before settlement work', () => {
  assert.match(cancellation, /rentalBookingLockKey\(input\.organizationId, input\.bookingId\)/);
  assert.match(cancellation, /rentalBookingFulfillmentEvent\.findFirst\(\{/);
  assert.match(cancellation, /where: \{ bookingId: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(cancellation, /select: \{ id: true, kind: true \}/);
  assert.match(cancellation, /if \(fulfillmentEvent\)[\s\S]*cannot be cancelled after physical custody has started/);
  assert.ok(
    cancellation.indexOf('if (fulfillmentEvent)') < cancellation.indexOf('readRentalPaymentSettlementHistory({'),
    'custody must fail closed before cancellation performs settlement reconciliation',
  );
});

test('cancelled replay fails closed if impossible custody evidence is retained', () => {
  assert.match(
    cancellation,
    /booking\.status === 'CANCELLED'[\s\S]*if \(fulfillmentEvent\)[\s\S]*Cancelled rental booking cannot retain physical-custody evidence/,
  );
});

test('fresh rental date changes inspect tenant-owned custody after the booking lock and reject returned bookings', () => {
  assert.match(reschedule, /rentalBookingLockKey\(input\.organizationId, input\.bookingId\)/);
  assert.match(reschedule, /fulfillmentEvents: \{/);
  assert.match(reschedule, /where: \{ organizationId: input\.organizationId \}/);
  assert.match(reschedule, /event\.kind === 'RETURNED'/);
  assert.match(reschedule, /event\.kind === 'PICKED_UP'/);
  assert.match(reschedule, /Returned rentals cannot be rescheduled or extended/);
});

test('picked-up date changes are limited to a same-start later-end extension under the effective-unit lock', () => {
  assert.match(reschedule, /rentalUnitLockKey\(input\.organizationId, effectiveUnitId\)/);
  assert.match(reschedule, /mode === 'CUSTODY_EXTENSION'/);
  assert.match(reschedule, /isRentalBookingCustodyExtensionTarget/);
  assert.match(reschedule, /A picked-up rental may only keep its current start date and extend the committed end date/);
  assert.match(custodyMigration, /NEW\."sourceStartsOn" <> current_starts_on/);
  assert.match(custodyMigration, /NEW\."sourceEndsOn" <> current_ends_on/);
  assert.match(custodyMigration, /NEW\."targetStartsOn" <> current_starts_on/);
  assert.match(custodyMigration, /NEW\."targetEndsOn" <= current_ends_on/);
});

test('completed reschedule replay remains idempotent after later custody while only fresh mutations inspect custody state', () => {
  const replay = reschedule.indexOf('if (existing) {');
  const freshLocator = reschedule.indexOf('const [bookingLocator, allocationLocator, latestSubstitutionLocator]');
  assert.ok(replay >= 0 && freshLocator > replay);
  assert.match(reschedule, /idempotent: true/);
});

test('fulfillment documentation separates locked custody mutations from the supported price-neutral extension exception', () => {
  assert.match(docs, /cancellation and physical-unit substitution remain closed/i);
  assert.match(docs, /same-unit, current-start, later-end extension/i);
  assert.match(docs, /database custody guard/i);
  assert.match(docs, /price-changing extensions remain unsupported/i);
});
