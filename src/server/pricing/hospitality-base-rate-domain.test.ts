import assert from 'node:assert/strict';
import test from 'node:test';

import { baseRateWindowsOverlap, normalizeHospitalityBaseRateInput } from './hospitality-base-rate-domain.ts';

test('normalizes base-rate scope, dates, and exact money', () => {
  const rate = normalizeHospitalityBaseRateInput({
    propertyId: ' property ',
    roomTypeId: ' room-type ',
    ratePlanId: ' rate-plan ',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    amount: '1500.25',
  }, 'PHP');
  assert.equal(rate.propertyId, 'property');
  assert.equal(rate.roomTypeId, 'room-type');
  assert.equal(rate.ratePlanId, 'rate-plan');
  assert.equal(rate.amountMinor, 150025n);
  assert.equal(rate.currency, 'PHP');
});

test('rejects invalid base-rate ranges and detects inclusive overlap', () => {
  assert.throws(() => normalizeHospitalityBaseRateInput({ propertyId: 'p', roomTypeId: 'r', ratePlanId: 'rp', startDate: '2026-09-10', endDate: '2026-09-09', amount: '1.00' }, 'USD'), /End date/);
  assert.equal(baseRateWindowsOverlap({ startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-10T00:00:00Z') }, { startDate: new Date('2026-09-10T00:00:00Z'), endDate: new Date('2026-09-20T00:00:00Z') }), true);
  assert.equal(baseRateWindowsOverlap({ startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-09T00:00:00Z') }, { startDate: new Date('2026-09-10T00:00:00Z'), endDate: new Date('2026-09-20T00:00:00Z') }), false);
});
