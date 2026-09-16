import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readBoundedRentalBookingHistory,
  RENTAL_BOOKING_HISTORY_MAX_ROWS,
} from './rental-booking-history.ts';

type Row = Readonly<{ id: string; value: number }>;

function makeRows(count: number): readonly Row[] {
  return Array.from({ length: count }, (_, index) => Object.freeze({
    id: String(index + 1).padStart(4, '0'),
    value: index + 1,
  }));
}

function makeReader(source: readonly Row[]) {
  return async (cursorId: string | undefined, take: number) => {
    const start = cursorId ? source.findIndex((row) => row.id === cursorId) + 1 : 0;
    return source.slice(start, start + take);
  };
}

test('rental booking history reads complete evidence through bounded cursor pages', async () => {
  const source = makeRows(205);
  const result = await readBoundedRentalBookingHistory({
    label: 'Rental booking reschedule history',
    readPage: makeReader(source),
  });

  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(result.rows.length, 205);
  assert.equal(result.rows[0]?.id, '0001');
  assert.equal(result.rows.at(-1)?.id, '0205');
});

test('rental booking history allows an exact safety-limit history', async () => {
  const source = makeRows(RENTAL_BOOKING_HISTORY_MAX_ROWS);
  const result = await readBoundedRentalBookingHistory({
    label: 'Rental booking substitution history',
    readPage: makeReader(source),
  });

  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(result.rows.length, RENTAL_BOOKING_HISTORY_MAX_ROWS);
});

test('rental booking history fails closed when evidence exceeds the safety limit', async () => {
  const source = makeRows(RENTAL_BOOKING_HISTORY_MAX_ROWS + 1);
  const result = await readBoundedRentalBookingHistory({
    label: 'Rental booking reschedule history',
    readPage: makeReader(source),
  });

  assert.equal(result.complete, false);
  if (result.complete) return;
  assert.match(result.reason, /1000-row history safety limit/);
});

test('rental booking history fails closed when a reader violates the requested page bound', async () => {
  const result = await readBoundedRentalBookingHistory({
    label: 'Rental booking substitution history',
    readPage: async (_cursorId, take) => makeRows(take + 1),
  });

  assert.equal(result.complete, false);
  if (result.complete) return;
  assert.match(result.reason, /more than the requested bounded page size/);
});
