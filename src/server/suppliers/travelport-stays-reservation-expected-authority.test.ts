import assert from 'node:assert/strict';
import test from 'node:test';

import { materializeTravelportStaysCreateExpectedReservation } from './travelport-stays-reservation-expected-authority.ts';

test('materializes immutable reservation identity before caller mutation', () => {
  const expected = {
    chainCode: 'CN',
    propertyCode: 'B6381',
    arrivalDateLocal: '2026-10-10',
    departureDateLocal: '2026-10-12',
    rooms: 1,
    guests: 2,
  };

  const snapshot = materializeTravelportStaysCreateExpectedReservation(expected);
  assert.ok(snapshot);
  expected.propertyCode = 'MUTATED';
  expected.departureDateLocal = '2026-11-20';
  expected.guests = 8;

  assert.deepEqual(snapshot, {
    chainCode: 'CN',
    propertyCode: 'B6381',
    arrivalDateLocal: '2026-10-10',
    departureDateLocal: '2026-10-12',
    rooms: 1,
    guests: 2,
  });
  assert.equal(Object.isFrozen(snapshot), true);
});

test('reads each authoritative reservation property exactly once', () => {
  const reads = new Map<string, number>();
  const values = {
    chainCode: 'CN',
    propertyCode: 'B6381',
    arrivalDateLocal: '2026-10-10',
    departureDateLocal: '2026-10-12',
    rooms: 1,
    guests: 2,
  } as const;
  const expected = Object.fromEntries(Object.entries(values).map(([key]) => [
    key,
    undefined,
  ])) as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(expected, key, {
      enumerable: true,
      get() {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return value;
      },
    });
  }

  assert.ok(materializeTravelportStaysCreateExpectedReservation(expected));
  for (const key of Object.keys(values)) assert.equal(reads.get(key), 1, key);
});

test('rejects malformed or unsupported reservation identity', () => {
  for (const expected of [
    null,
    [],
    { chainCode: 'CN', propertyCode: 'B6381', arrivalDateLocal: '2026-10-12', departureDateLocal: '2026-10-10', rooms: 1, guests: 2 },
    { chainCode: 'CN', propertyCode: 'B6381', arrivalDateLocal: '2026-10-10', departureDateLocal: '2026-10-12', rooms: 2, guests: 2 },
    { chainCode: 'CN', propertyCode: 'B6381', arrivalDateLocal: '2026-10-10', departureDateLocal: '2026-10-12', rooms: 1, guests: 10 },
    { chainCode: ' CN', propertyCode: 'B6381', arrivalDateLocal: '2026-10-10', departureDateLocal: '2026-10-12', rooms: 1, guests: 2 },
  ]) {
    assert.equal(materializeTravelportStaysCreateExpectedReservation(expected), null);
  }
});
