import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveRentalBookingCustodyReadState } from './rental-booking-custody-read-domain.ts';

const pickup = Object.freeze({
  kind: 'PICKED_UP' as const,
  endsOn: new Date('2026-09-16T00:00:00.000Z'),
});

const returned = Object.freeze({
  kind: 'RETURNED' as const,
  endsOn: new Date('2026-09-16T00:00:00.000Z'),
});

test('marks picked-up custody overdue from database time and the retained location timezone', () => {
  const observedAt = new Date('2026-09-15T16:15:00.000Z');
  const manila = deriveRentalBookingCustodyReadState({
    bookingStatus: 'CONFIRMED',
    fulfillmentState: 'PICKED_UP',
    fulfillmentEvents: [pickup],
    observedAt,
    timeZone: 'Asia/Manila',
  });
  const losAngeles = deriveRentalBookingCustodyReadState({
    bookingStatus: 'CONFIRMED',
    fulfillmentState: 'PICKED_UP',
    fulfillmentEvents: [pickup],
    observedAt,
    timeZone: 'America/Los_Angeles',
  });

  assert.equal(manila.overdue, true);
  assert.equal(manila.expectedReturnOn?.toISOString(), pickup.endsOn.toISOString());
  assert.equal(losAngeles.overdue, false);
});

test('awaiting pickup and returned custody are never presented as overdue open custody', () => {
  const observedAt = new Date('2026-09-20T00:00:00.000Z');

  assert.equal(deriveRentalBookingCustodyReadState({
    bookingStatus: 'CONFIRMED',
    fulfillmentState: 'AWAITING_PICKUP',
    fulfillmentEvents: [],
    observedAt,
    timeZone: 'Asia/Manila',
  }).overdue, false);

  assert.equal(deriveRentalBookingCustodyReadState({
    bookingStatus: 'CONFIRMED',
    fulfillmentState: 'RETURNED',
    fulfillmentEvents: [pickup, returned],
    observedAt,
    timeZone: 'Asia/Manila',
  }).overdue, false);
});

test('cancelled bookings fail closed if physical handoff evidence is present', () => {
  assert.throws(() => deriveRentalBookingCustodyReadState({
    bookingStatus: 'CANCELLED',
    fulfillmentState: 'PICKED_UP',
    fulfillmentEvents: [pickup],
    observedAt: new Date('2026-09-20T00:00:00.000Z'),
    timeZone: 'Asia/Manila',
  }), /cancelled rental booking custody evidence cannot include physical handoff events/i);
});

test('picked-up state fails closed if the retained pickup event is missing', () => {
  assert.throws(() => deriveRentalBookingCustodyReadState({
    bookingStatus: 'CONFIRMED',
    fulfillmentState: 'PICKED_UP',
    fulfillmentEvents: [],
    observedAt: new Date('2026-09-20T00:00:00.000Z'),
    timeZone: 'Asia/Manila',
  }), /missing its retained pickup evidence/i);
});
