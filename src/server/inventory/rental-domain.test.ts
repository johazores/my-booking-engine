import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRentalCurrency,
  normalizeRentalMoneyMinor,
  normalizeRentalRatePeriodInput,
  normalizeRentalUnitTypeInput,
  RentalInventoryValidationError,
} from './rental-domain.ts';

test('rental currency configuration accepts supported currencies and rejects fabricated codes', () => {
  assert.equal(normalizeRentalCurrency(' php '), 'PHP');
  assert.equal(normalizeRentalCurrency('JPY'), 'JPY');
  for (const invalid of ['ZZZ', 'FOO', 'XXX', 'US']) {
    assert.throws(() => normalizeRentalCurrency(invalid), RentalInventoryValidationError);
  }
});

test('rental rates reject exponent, hex, fractions, suffixes and unbounded minor-unit text', () => {
  for (const amount of ['100', ' 100 ', '000100']) assert.equal(normalizeRentalMoneyMinor(amount), 100);
  assert.equal(normalizeRentalMoneyMinor(100), 100);
  for (const amount of ['1e2', '0x64', '100.0', '+100', '100junk', '1'.repeat(65), '-1', '0']) {
    assert.throws(() => normalizeRentalMoneyMinor(amount), RentalInventoryValidationError);
  }
  assert.throws(() => normalizeRentalMoneyMinor(Number.MAX_SAFE_INTEGER), RentalInventoryValidationError);
  assert.equal(normalizeRentalUnitTypeInput({
    name: 'Kayak', code: 'KAYAK', currency: 'PHP', defaultDailyRateMinor: '000100',
  }).defaultDailyRateMinor, 100);
  assert.throws(() => normalizeRentalUnitTypeInput({
    name: 'Kayak', code: 'KAYAK', currency: 'PHP', defaultDailyRateMinor: '1e2',
  }), RentalInventoryValidationError);
  assert.equal(normalizeRentalRatePeriodInput({
    unitTypeId: 'unit-type', startsOn: '2026-11-01', endsOn: '2026-11-03', dailyRateMinor: '100',
  }).dailyRateMinor, 100);
  assert.throws(() => normalizeRentalRatePeriodInput({
    unitTypeId: 'unit-type', startsOn: '2026-11-01', endsOn: '2026-11-03', dailyRateMinor: '0x64',
  }), RentalInventoryValidationError);
});
