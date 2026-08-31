import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availabilityHoldPayloadMatches,
  calculateAvailabilityHoldCapacity,
  normalizeAvailabilityHoldInput,
} from './availability-hold-domain.ts';

test('normalizes bounded hold duration and idempotency key', () => {
  const normalized = normalizeAvailabilityHoldInput({
    idempotencyKey: ' checkout:abc-123 ',
    expiresInMinutes: '10',
    request: { propertyId: 'p', roomTypeId: 'rt', ratePlanId: 'rp', arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: 1 },
  });
  assert.equal(normalized.idempotencyKey, 'checkout:abc-123');
  assert.equal(normalized.expiresInMinutes, 10);
  assert.throws(() => normalizeAvailabilityHoldInput({ idempotencyKey: 'short', request: { propertyId: 'p', roomTypeId: 'rt', ratePlanId: 'rp', arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: 1 } }), /Idempotency key/);
  assert.throws(() => normalizeAvailabilityHoldInput({ idempotencyKey: 'checkout:abc-123', expiresInMinutes: 31, request: { propertyId: 'p', roomTypeId: 'rt', ratePlanId: 'rp', arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: 1 } }), /between 1 and 30/);
});

test('calculates remaining capacity per occupied night instead of overcounting non-overlapping holds', () => {
  const result = calculateAvailabilityHoldCapacity({
    physicalCapacity: 2,
    arrivalDate: new Date('2026-09-10T00:00:00.000Z'),
    departureDate: new Date('2026-09-12T00:00:00.000Z'),
    windows: [{ startDate: new Date('2026-09-10T00:00:00.000Z'), endDate: new Date('2026-09-10T00:00:00.000Z'), capacityLimit: 1 }],
    holds: [
      { arrivalDate: new Date('2026-09-10T00:00:00.000Z'), departureDate: new Date('2026-09-11T00:00:00.000Z'), quantity: 1 },
      { arrivalDate: new Date('2026-09-11T00:00:00.000Z'), departureDate: new Date('2026-09-12T00:00:00.000Z'), quantity: 1 },
    ],
  });
  assert.equal(result.sellableUnits, 0);
  assert.equal(result.peakHeldUnits, 1);
});

test('detects idempotency payload mismatch', () => {
  const request = normalizeAvailabilityHoldInput({
    idempotencyKey: 'checkout:abc-123',
    request: { propertyId: 'p', roomTypeId: 'rt', ratePlanId: 'rp', arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: 1 },
  }).request;
  assert.equal(availabilityHoldPayloadMatches({ hold: { propertyId: 'p', roomTypeId: 'rt', ratePlanId: 'rp', arrivalDate: new Date('2026-09-10T00:00:00.000Z'), departureDate: new Date('2026-09-12T00:00:00.000Z'), quantity: 1 }, request }), true);
  assert.equal(availabilityHoldPayloadMatches({ hold: { propertyId: 'p', roomTypeId: 'rt', ratePlanId: 'rp', arrivalDate: new Date('2026-09-10T00:00:00.000Z'), departureDate: new Date('2026-09-12T00:00:00.000Z'), quantity: 2 }, request }), false);
});
