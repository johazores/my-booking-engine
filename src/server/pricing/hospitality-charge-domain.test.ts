import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHospitalityChargeRuleInput, parsePercentageToBasisPoints, percentageAmountMinor } from './hospitality-charge-domain.ts';

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
