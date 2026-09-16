import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveRentalBookingPickupWindow } from './rental-booking-pickup-window-domain.ts';

const startsOn = new Date('2026-09-16T00:00:00.000Z');
const endsOn = new Date('2026-09-19T00:00:00.000Z');

test('opens pickup on the committed start date in the retained location timezone', () => {
  const window = deriveRentalBookingPickupWindow({
    observedAt: new Date('2026-09-15T16:00:00.000Z'),
    startsOn,
    endsOn,
    timeZone: 'Asia/Manila',
  });

  assert.equal(window.state, 'OPEN');
  assert.equal(window.observedLocalDate, '2026-09-16');
});

test('keeps pickup closed before the committed local start date', () => {
  const window = deriveRentalBookingPickupWindow({
    observedAt: new Date('2026-09-15T15:59:59.999Z'),
    startsOn,
    endsOn,
    timeZone: 'Asia/Manila',
  });

  assert.equal(window.state, 'BEFORE_WINDOW');
  assert.equal(window.observedLocalDate, '2026-09-15');
});

test('closes pickup when the exclusive committed end date is reached', () => {
  const window = deriveRentalBookingPickupWindow({
    observedAt: new Date('2026-09-18T16:00:00.000Z'),
    startsOn,
    endsOn,
    timeZone: 'Asia/Manila',
  });

  assert.equal(window.state, 'CLOSED');
  assert.equal(window.observedLocalDate, '2026-09-19');
});

test('uses the retained location timezone instead of the application server date', () => {
  const observedAt = new Date('2026-09-16T00:30:00.000Z');

  assert.equal(deriveRentalBookingPickupWindow({ observedAt, startsOn, endsOn, timeZone: 'Asia/Manila' }).state, 'OPEN');
  assert.equal(deriveRentalBookingPickupWindow({ observedAt, startsOn, endsOn, timeZone: 'America/Los_Angeles' }).state, 'BEFORE_WINDOW');
});

test('fails closed for invalid committed date evidence', () => {
  assert.throws(() => deriveRentalBookingPickupWindow({
    observedAt: new Date('2026-09-16T00:00:00.000Z'),
    startsOn: new Date('2026-09-19T00:00:00.000Z'),
    endsOn: new Date('2026-09-19T00:00:00.000Z'),
    timeZone: 'Asia/Manila',
  }), /valid exclusive-end rental period/i);
});
