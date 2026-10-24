import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateAvailabilityRestrictions,
  normalizeAvailabilityRequest,
  parseAvailabilityDate,
  AvailabilityValidationError,
} from './availability-domain.ts';

test('normalizes a bounded date-only availability request', () => {
  const request = normalizeAvailabilityRequest({
    propertyId: ' property ',
    roomTypeId: ' room-type ',
    ratePlanId: ' rate-plan ',
    arrivalDate: '2026-09-01',
    departureDate: '2026-09-04',
    quantity: '2',
  });
  assert.equal(request.propertyId, 'property');
  assert.equal(request.stayNights, 3);
  assert.equal(request.quantity, 2);
  assert.throws(() => normalizeAvailabilityRequest({ propertyId: 'p', roomTypeId: 'r', ratePlanId: 'x', arrivalDate: '2026-09-04', departureDate: '2026-09-04', quantity: 1 }), /after arrival/);
  assert.throws(() => normalizeAvailabilityRequest({ propertyId: 'p', roomTypeId: 'r', ratePlanId: 'x', arrivalDate: '2026-09-04', departureDate: '2026-09-05', quantity: '2rooms' }), /quantity must be between/i);
  assert.throws(() => parseAvailabilityDate('2026-02-30', 'Arrival date'), /valid calendar/);
});

test('quantity validation rejects malformed JSON scalars with a typed error', () => {
  const base = { propertyId: 'p', roomTypeId: 'r', ratePlanId: 'x', arrivalDate: '2026-09-04', departureDate: '2026-09-05' };
  for (const quantity of ['2rooms', '2.5', '2e1', '0x10', '1'.repeat(17), '', ['2'], null, true]) {
    assert.throws(
      () => normalizeAvailabilityRequest({ ...base, quantity: quantity as string }),
      /Quantity must be between 1 and 50/,
    );
  }
  for (const quantity of [' 2 ', '02', 1, 50]) {
    assert.equal(normalizeAvailabilityRequest({ ...base, quantity }).quantity, Number(quantity));
  }
});

test('combines overlapping restriction rules conservatively', () => {
  const arrivalDate = parseAvailabilityDate('2026-09-10', 'Arrival date');
  const departureDate = parseAvailabilityDate('2026-09-12', 'Departure date');
  const result = evaluateAvailabilityRestrictions({
    arrivalDate,
    departureDate,
    stayNights: 2,
    restrictions: [
      { startDate: parseAvailabilityDate('2026-09-01', 'Start'), endDate: parseAvailabilityDate('2026-09-30', 'End'), minStayNights: 3, maxStayNights: null, closedToArrival: false, closedToDeparture: false },
      { startDate: parseAvailabilityDate('2026-09-10', 'Start'), endDate: parseAvailabilityDate('2026-09-10', 'End'), minStayNights: null, maxStayNights: 5, closedToArrival: true, closedToDeparture: false },
    ],
  });
  assert.equal(result.allowed, false);
  assert.equal(result.minimumStayNights, 3);
  assert.equal(result.maximumStayNights, 5);
  assert.deepEqual(result.reasons.sort(), ['closed-to-arrival', 'minimum-stay']);
});

test('departure closures are evaluated on the requested departure date', () => {
  const result = evaluateAvailabilityRestrictions({
    arrivalDate: parseAvailabilityDate('2026-10-01', 'Arrival'),
    departureDate: parseAvailabilityDate('2026-10-03', 'Departure'),
    stayNights: 2,
    restrictions: [
      { startDate: parseAvailabilityDate('2026-10-03', 'Start'), endDate: parseAvailabilityDate('2026-10-03', 'End'), minStayNights: null, maxStayNights: null, closedToArrival: false, closedToDeparture: true },
    ],
  });
  assert.equal(result.closedToDeparture, true);
  assert.deepEqual(result.reasons, ['closed-to-departure']);
});

test('availability normalization rejects malformed runtime date and resource scalars', () => {
  const valid = { propertyId: 'p', roomTypeId: 'r', ratePlanId: 'rp', arrivalDate: '2026-09-01', departureDate: '2026-09-02', quantity: 1 };
  for (const value of [null, undefined, 7, true, {}, []]) {
    assert.throws(() => parseAvailabilityDate(value as never, 'Arrival date'), AvailabilityValidationError);
    assert.throws(() => normalizeAvailabilityRequest(value as never), AvailabilityValidationError);
    for (const field of ['propertyId', 'roomTypeId', 'ratePlanId', 'arrivalDate', 'departureDate']) assert.throws(() => normalizeAvailabilityRequest({ ...valid, [field]: value } as never), AvailabilityValidationError);
  }
});
