import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveRentalBookingPickupReadState } from './rental-booking-pickup-read-domain.ts';

const period = Object.freeze({
  startsOn: new Date('2026-09-15T00:00:00.000Z'),
  endsOn: new Date('2026-09-16T00:00:00.000Z'),
});

test('marks confirmed awaiting-pickup bookings missed only after the exclusive local end', () => {
  const beforeEnd = deriveRentalBookingPickupReadState({
    bookingStatus: 'CONFIRMED',
    fulfillmentState: 'AWAITING_PICKUP',
    observedAt: new Date('2026-09-15T15:59:59.000Z'),
    startsOn: period.startsOn,
    endsOn: period.endsOn,
    timeZone: 'Asia/Manila',
  });
  const atEnd = deriveRentalBookingPickupReadState({
    bookingStatus: 'CONFIRMED',
    fulfillmentState: 'AWAITING_PICKUP',
    observedAt: new Date('2026-09-15T16:00:00.000Z'),
    startsOn: period.startsOn,
    endsOn: period.endsOn,
    timeZone: 'Asia/Manila',
  });

  assert.equal(beforeEnd.window.state, 'OPEN');
  assert.equal(beforeEnd.missed, false);
  assert.equal(atEnd.window.state, 'CLOSED');
  assert.equal(atEnd.missed, true);
});

test('does not classify pre-start confirmed bookings as missed pickup', () => {
  const state = deriveRentalBookingPickupReadState({
    bookingStatus: 'CONFIRMED',
    fulfillmentState: 'AWAITING_PICKUP',
    observedAt: new Date('2026-09-14T12:00:00.000Z'),
    startsOn: period.startsOn,
    endsOn: period.endsOn,
    timeZone: 'Asia/Manila',
  });

  assert.equal(state.window.state, 'BEFORE_WINDOW');
  assert.equal(state.missed, false);
});

test('does not classify picked-up or returned bookings as missed pickup', () => {
  for (const fulfillmentState of ['PICKED_UP', 'RETURNED'] as const) {
    const state = deriveRentalBookingPickupReadState({
      bookingStatus: 'CONFIRMED',
      fulfillmentState,
      observedAt: new Date('2026-09-20T00:00:00.000Z'),
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      timeZone: 'Asia/Manila',
    });

    assert.equal(state.window.state, 'CLOSED');
    assert.equal(state.missed, false);
  }
});

test('does not classify cancelled bookings as missed pickup', () => {
  const state = deriveRentalBookingPickupReadState({
    bookingStatus: 'CANCELLED',
    fulfillmentState: 'AWAITING_PICKUP',
    observedAt: new Date('2026-09-20T00:00:00.000Z'),
    startsOn: period.startsOn,
    endsOn: period.endsOn,
    timeZone: 'Asia/Manila',
  });

  assert.equal(state.missed, false);
});
