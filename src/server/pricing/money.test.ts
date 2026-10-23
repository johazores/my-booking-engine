import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currencyMinorUnitDigits,
  moneyMinorToMajorString,
  multiplyMoneyMinor,
  normalizeCurrency,
  parseMoneyMajorToMinor,
  PricingValidationError,
} from './money.ts';

test('normalizes supported currencies and respects minor-unit digits', () => {
  assert.equal(normalizeCurrency(' php '), 'PHP');
  assert.equal(currencyMinorUnitDigits('USD'), 2);
  assert.equal(currencyMinorUnitDigits('JPY'), 0);
  assert.equal(currencyMinorUnitDigits('BHD'), 3);
  for (const invalid of ['ZZZ', 'FOO', 'XXX', 'XTS']) {
    assert.throws(() => normalizeCurrency(invalid), /supported by the runtime currency data/);
  }
});

test('parses decimal money to exact integer minor units', () => {
  assert.deepEqual(parseMoneyMajorToMinor('1250.50', 'PHP'), { amountMinor: 125050n, currency: 'PHP' });
  assert.deepEqual(parseMoneyMajorToMinor('900', 'JPY'), { amountMinor: 900n, currency: 'JPY' });
  assert.deepEqual(parseMoneyMajorToMinor('1.234', 'BHD'), { amountMinor: 1234n, currency: 'BHD' });
  assert.equal(moneyMinorToMajorString(125050n, 'PHP'), '1250.50');
});

test('bounds decimal money input before integer conversion', () => {
  assert.deepEqual(parseMoneyMajorToMinor('0'.repeat(64), 'USD'), { amountMinor: 0n, currency: 'USD' });
  assert.throws(() => parseMoneyMajorToMinor('0'.repeat(65), 'USD'), /supported input length/);
  assert.throws(() => parseMoneyMajorToMinor(' '.repeat(65) + '1', 'USD'), /supported input length/);
});

test('rejects unsafe or ambiguous monetary input', () => {
  assert.throws(() => parseMoneyMajorToMinor('-1.00', 'USD'), /non-negative/);
  assert.throws(() => parseMoneyMajorToMinor('1,000.00', 'USD'), /without separators/);
  assert.throws(() => parseMoneyMajorToMinor('1.001', 'USD'), /more than 2 decimal/);
  assert.throws(() => normalizeCurrency('US'), /three-letter/);
});

test('money multiplication rejects negative and out-of-range components before multiplying', () => {
  assert.equal(multiplyMoneyMinor(125n, 2), 250n);
  assert.equal(multiplyMoneyMinor(0n, 0), 0n);
  for (const amount of [-1n, 9_000_000_000_000_001n]) {
    assert.throws(() => multiplyMoneyMinor(amount, 0), PricingValidationError);
    assert.throws(() => multiplyMoneyMinor(amount, 1), PricingValidationError);
  }
  assert.throws(() => multiplyMoneyMinor(9_000_000_000_000_000n, 2), PricingValidationError);
});
