import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHospitalityOfferSearchInput } from './hospitality-search-domain.ts';

test('normalizes a valid hospitality offer search to canonical commercial input', () => {
  const normalized = normalizeHospitalityOfferSearchInput({
    arrivalDate: ' 2026-09-10 ',
    departureDate: ' 2026-09-13 ',
    quantity: ' 2 ',
    propertyId: '  property-id  ',
  });
  assert.equal(normalized.arrivalDate, '2026-09-10');
  assert.equal(normalized.departureDate, '2026-09-13');
  assert.equal(normalized.arrivalDateValue.toISOString(), '2026-09-10T00:00:00.000Z');
  assert.equal(normalized.departureDateValue.toISOString(), '2026-09-13T00:00:00.000Z');
  assert.equal(normalized.stayNights, 3);
  assert.equal(normalized.quantity, 2);
  assert.equal(normalized.propertyId, 'property-id');
});

test('normalizes an omitted property filter to null', () => {
  const normalized = normalizeHospitalityOfferSearchInput({
    arrivalDate: '2026-09-10',
    departureDate: '2026-09-11',
    quantity: 1,
    propertyId: '   ',
  });
  assert.equal(normalized.propertyId, null);
});

test('rejects invalid date ranges and quantities', () => {
  assert.throws(() => normalizeHospitalityOfferSearchInput({ arrivalDate: '2026-09-10', departureDate: '2026-09-10', quantity: 1 }), /after arrival/);
  assert.throws(() => normalizeHospitalityOfferSearchInput({ arrivalDate: '2026-09-10', departureDate: '2026-09-11', quantity: '2rooms' }), /between 1 and 50/);
  assert.throws(() => normalizeHospitalityOfferSearchInput({ arrivalDate: '2026-09-10', departureDate: '2026-09-11', quantity: 51 }), /between 1 and 50/);
  assert.throws(() => normalizeHospitalityOfferSearchInput({ arrivalDate: '2026-02-30', departureDate: '2026-03-02', quantity: 1 }), /valid calendar date/);
  assert.throws(() => normalizeHospitalityOfferSearchInput({ arrivalDate: '2026-09-10', departureDate: '2027-09-11', quantity: 1 }), /365 nights/);
});
