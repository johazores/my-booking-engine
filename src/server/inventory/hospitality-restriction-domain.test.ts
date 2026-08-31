import assert from 'node:assert/strict';
import test from 'node:test';

import { formatRestrictionDate, normalizeHospitalityRestrictionInput } from './hospitality-restriction-domain.ts';

test('normalizes hospitality restriction dates, stay controls, and scope', () => {
  const restriction = normalizeHospitalityRestrictionInput({
    propertyId: ' property ',
    ratePlanId: ' plan ',
    roomTypeId: ' room-type ',
    startDate: '2026-12-20',
    endDate: '2026-12-31',
    minStayNights: ' 2 ',
    maxStayNights: '7',
    closedToArrival: 'true',
    closedToDeparture: '',
  });

  assert.equal(restriction.propertyId, 'property');
  assert.equal(restriction.ratePlanId, 'plan');
  assert.equal(restriction.roomTypeId, 'room-type');
  assert.equal(formatRestrictionDate(restriction.startDate), '2026-12-20');
  assert.equal(formatRestrictionDate(restriction.endDate), '2026-12-31');
  assert.equal(restriction.minStayNights, 2);
  assert.equal(restriction.maxStayNights, 7);
  assert.equal(restriction.closedToArrival, true);
  assert.equal(restriction.closedToDeparture, false);
});

test('allows a property-wide restriction and rejects empty or invalid rules', () => {
  const propertyWide = normalizeHospitalityRestrictionInput({
    propertyId: 'property',
    ratePlanId: 'plan',
    roomTypeId: '',
    startDate: '2027-01-01',
    endDate: '2027-01-01',
    minStayNights: '',
    maxStayNights: '',
    closedToArrival: '',
    closedToDeparture: 'on',
  });
  assert.equal(propertyWide.roomTypeId, null);
  assert.equal(propertyWide.closedToDeparture, true);

  assert.throws(() => normalizeHospitalityRestrictionInput({
    propertyId: 'property', ratePlanId: 'plan', roomTypeId: '', startDate: '2027-02-30', endDate: '2027-03-01', minStayNights: '2', maxStayNights: '', closedToArrival: '', closedToDeparture: '',
  }), /real calendar date/);
  assert.throws(() => normalizeHospitalityRestrictionInput({
    propertyId: 'property', ratePlanId: 'plan', roomTypeId: '', startDate: '2027-03-02', endDate: '2027-03-01', minStayNights: '2', maxStayNights: '', closedToArrival: '', closedToDeparture: '',
  }), /on or after/);
  assert.throws(() => normalizeHospitalityRestrictionInput({
    propertyId: 'property', ratePlanId: 'plan', roomTypeId: '', startDate: '2027-03-01', endDate: '2027-03-02', minStayNights: '8', maxStayNights: '3', closedToArrival: '', closedToDeparture: '',
  }), /cannot exceed/);
  assert.throws(() => normalizeHospitalityRestrictionInput({
    propertyId: 'property', ratePlanId: 'plan', roomTypeId: '', startDate: '2027-03-01', endDate: '2027-03-02', minStayNights: '', maxStayNights: '', closedToArrival: '', closedToDeparture: '',
  }), /at least one/);
});
