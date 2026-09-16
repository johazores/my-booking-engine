import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rentalCustodyIsOverdue,
  rentalLocalDateKey,
} from './rental-custody-availability.ts';

test('derives the location-local custody date from a database timestamp', () => {
  const observedAt = new Date('2026-09-15T16:15:00.000Z');
  assert.equal(rentalLocalDateKey(observedAt, 'Asia/Manila'), '2026-09-16');
  assert.equal(rentalLocalDateKey(observedAt, 'America/Los_Angeles'), '2026-09-15');
});

test('marks unreturned custody overdue at the exclusive end date in the rental location', () => {
  const observedAt = new Date('2026-09-15T16:15:00.000Z');
  assert.equal(rentalCustodyIsOverdue({
    observedAt,
    endsOn: new Date('2026-09-16T00:00:00.000Z'),
    timeZone: 'Asia/Manila',
  }), true);
  assert.equal(rentalCustodyIsOverdue({
    observedAt,
    endsOn: new Date('2026-09-16T00:00:00.000Z'),
    timeZone: 'America/Los_Angeles',
  }), false);
});

test('fails closed for invalid location timezones', () => {
  assert.throws(
    () => rentalLocalDateKey(new Date('2026-09-15T16:15:00.000Z'), 'Not/A_Timezone'),
    /timezone is invalid/i,
  );
});
