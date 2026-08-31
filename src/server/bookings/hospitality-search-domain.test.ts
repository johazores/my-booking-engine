import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHospitalityOfferSearchInput } from './hospitality-search-domain.ts';

test('normalizes a valid hospitality offer search', () => {
  const normalized = normalizeHospitalityOfferSearchInput({
    arrivalDate: '2026-09-10',
    departureDate: '2026-09-13',
    quantity: '2',
    propertyId: '  property-id  ',
  });
  assert.equal(normalized.stayNights, 3);
  assert.equal(normalized.quantity, 2);
  assert.equal(normalized.propertyId, 'property-id');
});

test('rejects invalid date ranges and quantities', () => {
  assert.throws(() => normalizeHospitalityOfferSearchInput({ arrivalDate: '2026-09-10', departureDate: '2026-09-10', quantity: 1 }), /after arrival/);
  assert.throws(() => normalizeHospitalityOfferSearchInput({ arrivalDate: '2026-09-10', departureDate: '2026-09-11', quantity: '2rooms' }), /between 1 and 50/);
  assert.throws(() => normalizeHospitalityOfferSearchInput({ arrivalDate: '2026-09-10', departureDate: '2026-09-11', quantity: 51 }), /between 1 and 50/);
});
