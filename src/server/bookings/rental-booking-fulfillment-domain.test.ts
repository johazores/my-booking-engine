import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveRentalBookingFulfillmentState, rentalBookingFulfillmentIdempotencyKey } from './rental-booking-fulfillment-domain.ts';

test('rental fulfillment starts awaiting pickup', () => {
  assert.deepEqual(deriveRentalBookingFulfillmentState([]), { state: 'AWAITING_PICKUP', pickedUpAt: null, returnedAt: null });
});

test('rental fulfillment derives pickup then return', () => {
  const pickup = new Date('2026-10-10T01:00:00.000Z');
  const returned = new Date('2026-10-12T07:00:00.000Z');
  assert.equal(deriveRentalBookingFulfillmentState([{ kind: 'PICKED_UP', occurredAt: pickup }]).state, 'PICKED_UP');
  assert.deepEqual(deriveRentalBookingFulfillmentState([
    { kind: 'PICKED_UP', occurredAt: pickup },
    { kind: 'RETURNED', occurredAt: returned },
  ]), { state: 'RETURNED', pickedUpAt: pickup, returnedAt: returned });
});

test('rental fulfillment rejects return before pickup and duplicates', () => {
  const now = new Date('2026-10-10T01:00:00.000Z');
  assert.throws(() => deriveRentalBookingFulfillmentState([{ kind: 'RETURNED', occurredAt: now }]), /requires an earlier pickup/i);
  assert.throws(() => deriveRentalBookingFulfillmentState([
    { kind: 'PICKED_UP', occurredAt: now },
    { kind: 'PICKED_UP', occurredAt: now },
  ]), /duplicate pickup/i);
  assert.throws(() => deriveRentalBookingFulfillmentState([
    { kind: 'PICKED_UP', occurredAt: now },
    { kind: 'RETURNED', occurredAt: new Date('2026-10-09T01:00:00.000Z') },
  ]), /cannot predate pickup/i);
});

test('rental fulfillment idempotency key is server deterministic', () => {
  const bookingId = '00000000-0000-4000-8000-000000000001';
  assert.equal(rentalBookingFulfillmentIdempotencyKey(bookingId, 'PICKED_UP'), `rental-fulfillment:${bookingId}:picked_up`);
  assert.equal(rentalBookingFulfillmentIdempotencyKey(bookingId, 'RETURNED'), `rental-fulfillment:${bookingId}:returned`);
});
