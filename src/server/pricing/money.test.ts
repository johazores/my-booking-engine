import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currencyMinorUnitDigits,
  moneyMinorToMajorString,
  normalizeCurrency,
  parseMoneyMajorToMinor,
} from './money.ts';

test('normalizes supported currencies and respects minor-unit digits', () => {
  assert.equal(normalizeCurrency(' php '), 'PHP');
  assert.equal(currencyMinorUnitDigits('USD'), 2);
  assert.equal(currencyMinorUnitDigits('JPY'), 0);
  assert.equal(currencyMinorUnitDigits('BHD'), 3);
});

test('parses decimal money to exact integer minor units', () => {
  assert.deepEqual(parseMoneyMajorToMinor('1250.50', 'PHP'), { amountMinor: 125050n, currency: 'PHP' });
  assert.deepEqual(parseMoneyMajorToMinor('900', 'JPY'), { amountMinor: 900n, currency: 'JPY' });
  assert.deepEqual(parseMoneyMajorToMinor('1.234', 'BHD'), { amountMinor: 1234n, currency: 'BHD' });
  assert.equal(moneyMinorToMajorString(125050n, 'PHP'), '1250.50');
});

test('rejects unsafe or ambiguous monetary input', () => {
  assert.throws(() => parseMoneyMajorToMinor('-1.00', 'USD'), /non-negative/);
  assert.throws(() => parseMoneyMajorToMinor('1,000.00', 'USD'), /without separators/);
  assert.throws(() => parseMoneyMajorToMinor('1.001', 'USD'), /more than 2 decimal/);
  assert.throws(() => normalizeCurrency('US'), /three-letter/);
});
