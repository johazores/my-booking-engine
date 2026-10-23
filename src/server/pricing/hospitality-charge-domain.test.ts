import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateHospitalityChargeAmountMinor, normalizeHospitalityChargeRuleInput, parsePercentageToBasisPoints, percentageAmountMinor } from './hospitality-charge-domain.ts';

test('normalizes percentage tax rules and exact scopes', () => {
  const rule = normalizeHospitalityChargeRuleInput({ propertyId: ' property ', roomTypeId: '', ratePlanId: '', name: ' VAT ', code: ' vat ', kind: 'tax', calculation: 'percentage', value: '12.5', startDate: '2026-09-01', endDate: '2026-12-31' }, 'PHP');
  assert.equal(rule.code, 'VAT');
  assert.equal(rule.kind, 'TAX');
  assert.equal(rule.percentageBps, 1250);
  assert.equal(rule.amountMinor, null);
  assert.equal(rule.roomTypeId, null);
});

test('validates fixed charge values and paired scoped identifiers', () => {
  const rule = normalizeHospitalityChargeRuleInput({ propertyId: 'p', roomTypeId: 'rt', ratePlanId: 'rp', name: 'Resort fee', code: 'RESORT', kind: 'FEE', calculation: 'FIXED_PER_ROOM_NIGHT', value: '250.00', startDate: '2026-09-01', endDate: '2026-09-30' }, 'PHP');
  assert.equal(rule.amountMinor, 25_000n);
  assert.equal(rule.currency, 'PHP');
  assert.throws(() => normalizeHospitalityChargeRuleInput({ propertyId: 'p', roomTypeId: 'rt', ratePlanId: '', name: 'Bad', code: 'BAD', kind: 'FEE', calculation: 'PERCENTAGE', value: '1', startDate: '2026-09-01', endDate: '2026-09-30' }, 'PHP'), /both a room type and rate plan/);
  assert.throws(() => parsePercentageToBasisPoints('100.01'), /no more than 100/);
});

test('percentage money calculation rounds half up to the nearest minor unit', () => {
  assert.equal(percentageAmountMinor(999n, 1250), 125n);
  assert.equal(percentageAmountMinor(1000n, 1250), 125n);
});

test('persisted percentage and fixed charge models produce exact bounded totals', () => {
  const base = {
    kind: 'TAX', calculation: 'PERCENTAGE', percentageBps: 1250,
    amountMinor: null, currency: null, quoteCurrency: 'PHP',
    eligibleUnitSubtotalMinor: 999n, eligibleNights: 2, roomQuantity: 2,
  };
  assert.equal(calculateHospitalityChargeAmountMinor(base), 250n);
  assert.equal(calculateHospitalityChargeAmountMinor({
    ...base, kind: 'FEE', calculation: 'FIXED_PER_BOOKING',
    percentageBps: null, amountMinor: 100n, currency: 'PHP',
  }), 100n);
  assert.equal(calculateHospitalityChargeAmountMinor({
    ...base, kind: 'FEE', calculation: 'FIXED_PER_ROOM_NIGHT',
    percentageBps: null, amountMinor: 100n, currency: 'PHP',
  }), 400n);
});

test('persisted charge corruption cannot silently change tax or fee meaning', () => {
  const base = {
    kind: 'TAX', calculation: 'PERCENTAGE', percentageBps: 1250,
    amountMinor: null, currency: null, quoteCurrency: 'PHP',
    eligibleUnitSubtotalMinor: 1000n, eligibleNights: 2, roomQuantity: 1,
  };
  for (const invalid of [
    { kind: 'UNKNOWN' },
    { calculation: 'UNKNOWN' },
    { percentageBps: null },
    { percentageBps: 0 },
    { percentageBps: 10_001 },
    { amountMinor: 100n },
    { currency: 'PHP' },
    { calculation: 'FIXED_PER_BOOKING', amountMinor: 100n, currency: 'PHP' },
    { calculation: 'FIXED_PER_BOOKING', percentageBps: null, amountMinor: 100n, currency: 'USD' },
    { calculation: 'FIXED_PER_BOOKING', percentageBps: null, amountMinor: 0n, currency: 'PHP' },
    { eligibleNights: 0 },
    { roomQuantity: 0 },
  ]) {
    assert.throws(() => calculateHospitalityChargeAmountMinor({ ...base, ...invalid }), /charge|money/i);
  }
  assert.throws(() => percentageAmountMinor(9_000_000_000_000_001n, 0), /money range/i);
});
