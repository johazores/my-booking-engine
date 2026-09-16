import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cancellation = readFileSync('src/server/bookings/rental-booking-cancellation-service.ts', 'utf8');
const reschedule = readFileSync('src/server/bookings/rental-booking-reschedule-service.ts', 'utf8');
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

test('fresh reschedule apply authority excludes fulfillment evidence at both pre-lock lookup and post-unit-lock re-read', () => {
  const preCustodyPredicates = reschedule.match(
    /fulfillmentEvents: \{ none: \{ organizationId: input\.organizationId \} \}/g,
  ) ?? [];
  assert.equal(preCustodyPredicates.length, 2);
  assert.match(reschedule, /rentalBookingLockKey\(input\.organizationId, input\.bookingId\)/);
  assert.match(reschedule, /rentalUnitLockKey\(input\.organizationId, effectiveUnitId\)/);
});

test('completed reschedule replay remains idempotent after later custody while only fresh mutations are pre-custody', () => {
  const replay = reschedule.indexOf('if (existing) {');
  const firstPreCustodyPredicate = reschedule.indexOf('fulfillmentEvents: { none: { organizationId: input.organizationId } }');
  assert.ok(replay >= 0 && firstPreCustodyPredicate > replay);
  assert.match(reschedule, /idempotent: true/);
});

test('fulfillment documentation describes application and database pre-custody enforcement separately', () => {
  assert.match(docs, /fresh cancellation and reschedule writers/i);
  assert.match(docs, /tenant-owned fulfillment evidence/i);
  assert.match(docs, /database guards remain defense in depth/i);
});
