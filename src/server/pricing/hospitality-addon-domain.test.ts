import assert from 'node:assert/strict';
import test from 'node:test';

import { hospitalityAddonAmountMinor, normalizeHospitalityAddonInput, normalizeHospitalityAddonSelections } from './hospitality-addon-domain.ts';

const propertyId = '11111111-1111-4111-8111-111111111111';
const roomTypeId = '22222222-2222-4222-8222-222222222222';
const ratePlanId = '33333333-3333-4333-8333-333333333333';

function validAddon() {
  return {
    propertyId,
    roomTypeId,
    ratePlanId,
    name: 'Airport transfer',
    code: 'airport-transfer',
    description: 'Private arrival transfer',
    pricingModel: 'PER_BOOKING',
    amount: '1250.50',
    maxQuantity: '1',
    startDate: '2026-09-01',
    endDate: '2027-08-31',
  };
}

test('normalizes exact add-on money and sellable scope', () => {
  const addon = normalizeHospitalityAddonInput(validAddon(), 'PHP');
  assert.equal(addon.code, 'AIRPORT-TRANSFER');
  assert.equal(addon.amountMinor, 125050n);
  assert.equal(addon.currency, 'PHP');
  assert.equal(addon.roomTypeId, roomTypeId);
  assert.equal(addon.ratePlanId, ratePlanId);
  assert.equal(addon.maxQuantity, 1);
});

test('requires a complete optional room-type/rate-plan scope', () => {
  assert.throws(() => normalizeHospitalityAddonInput({ ...validAddon(), ratePlanId: '' }, 'PHP'), /scope must be property-wide or use both/i);
});

test('rejects unsupported, zero, and malformed add-on prices', () => {
  assert.throws(() => normalizeHospitalityAddonInput({ ...validAddon(), pricingModel: 'PER_GUEST' }, 'PHP'), /not supported/i);
  assert.throws(() => normalizeHospitalityAddonInput({ ...validAddon(), amount: '0.00' }, 'PHP'), /greater than zero/i);
  assert.throws(() => normalizeHospitalityAddonInput({ ...validAddon(), amount: '12.345' }, 'PHP'), /decimal/i);
});

test('normalizes selected add-ons deterministically and rejects duplicate selection', () => {
  const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  assert.deepEqual(normalizeHospitalityAddonSelections([
    { addonId: second, quantity: 2 },
    { addonId: first, quantity: 1 },
  ]), [
    { addonId: first, quantity: 1 },
    { addonId: second, quantity: 2 },
  ]);
  assert.throws(() => normalizeHospitalityAddonSelections([
    { addonId: first, quantity: 1 },
    { addonId: first, quantity: 1 },
  ]), /cannot be selected more than once/i);
});

test('calculates each add-on pricing model with integer minor units', () => {
  assert.equal(hospitalityAddonAmountMinor({ amountMinor: 1000n, pricingModel: 'PER_BOOKING', selectedQuantity: 1, roomQuantity: 2, stayNights: 3, maxQuantity: 1 }), 1000n);
  assert.equal(hospitalityAddonAmountMinor({ amountMinor: 1000n, pricingModel: 'PER_ROOM', selectedQuantity: 1, roomQuantity: 2, stayNights: 3, maxQuantity: 1 }), 2000n);
  assert.equal(hospitalityAddonAmountMinor({ amountMinor: 1000n, pricingModel: 'PER_ROOM_NIGHT', selectedQuantity: 1, roomQuantity: 2, stayNights: 3, maxQuantity: 1 }), 6000n);
  assert.equal(hospitalityAddonAmountMinor({ amountMinor: 1000n, pricingModel: 'PER_UNIT', selectedQuantity: 4, roomQuantity: 2, stayNights: 3, maxQuantity: 5 }), 4000n);
});

test('prevents browser quantity from multiplying non-unit add-ons', () => {
  assert.throws(() => hospitalityAddonAmountMinor({ amountMinor: 1000n, pricingModel: 'PER_ROOM_NIGHT', selectedQuantity: 2, roomQuantity: 2, stayNights: 3, maxQuantity: 5 }), /only per-unit/i);
  assert.throws(() => normalizeHospitalityAddonSelections([{ addonId: propertyId, quantity: 101 }]), /quantity must be between/i);
});
