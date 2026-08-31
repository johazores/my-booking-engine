import assert from 'node:assert/strict';
import test from 'node:test';

import { effectiveWindowCapacity, normalizeAvailabilityWindowInput } from './availability-window-domain.ts';

test('normalizes availability windows and enforces capacity bounds', () => {
  const window = normalizeAvailabilityWindowInput({ propertyId: ' p ', roomTypeId: ' r ', startDate: '2026-09-10', endDate: '2026-09-12', capacityLimit: '2' });
  assert.equal(window.propertyId, 'p');
  assert.equal(window.roomTypeId, 'r');
  assert.equal(window.capacityLimit, 2);
  assert.throws(() => normalizeAvailabilityWindowInput({ propertyId: 'p', roomTypeId: 'r', startDate: '2026-09-12', endDate: '2026-09-10', capacityLimit: 2 }), /on or after/);
  assert.throws(() => normalizeAvailabilityWindowInput({ propertyId: 'p', roomTypeId: 'r', startDate: '2026-09-10', endDate: '2026-09-12', capacityLimit: 51 }), /between 0 and 50/);
});

test('availability windows can only reduce physical capacity', () => {
  const arrivalDate = new Date('2026-09-10T00:00:00Z');
  const departureDate = new Date('2026-09-13T00:00:00Z');
  assert.equal(effectiveWindowCapacity({ physicalCapacity: 3, arrivalDate, departureDate, windows: [] }), 3);
  assert.equal(effectiveWindowCapacity({ physicalCapacity: 3, arrivalDate, departureDate, windows: [{ startDate: new Date('2026-09-11T00:00:00Z'), endDate: new Date('2026-09-12T00:00:00Z'), capacityLimit: 1 }] }), 1);
  assert.equal(effectiveWindowCapacity({ physicalCapacity: 2, arrivalDate, departureDate, windows: [{ startDate: new Date('2026-09-10T00:00:00Z'), endDate: new Date('2026-09-12T00:00:00Z'), capacityLimit: 5 }] }), 2);
});
