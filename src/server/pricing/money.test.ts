import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addMoneyMinor,
  currencyMinorUnitDigits,
  isSupportedCurrencyCode,
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


test('malformed currency scalars produce typed pricing failures without coercion', () => {
  for (const value of [null, undefined, 123, true, {}, [], Symbol('USD')]) {
    assert.equal(isSupportedCurrencyCode(value as never), false);
    assert.throws(() => normalizeCurrency(value as never), PricingValidationError);
    assert.throws(() => currencyMinorUnitDigits(value as never), PricingValidationError);
  }
});

test('malformed major-unit scalars fail before parsing or conversion', () => {
  for (const value of [null, undefined, 10, 1.25, 10n, false, {}, [], Symbol('10')]) {
    assert.throws(() => parseMoneyMajorToMinor(value as never, 'USD'), PricingValidationError);
  }
});

test('minor-unit formatting and multiplication reject malformed scalars even for zero quantity', () => {
  for (const value of [null, undefined, 125, '125', true, {}, [], Symbol('125')]) {
    assert.throws(() => moneyMinorToMajorString(value as never, 'JPY'), PricingValidationError);
    assert.throws(() => multiplyMoneyMinor(value as never, 0), PricingValidationError);
  }
  assert.equal(multiplyMoneyMinor(0n, 0), 0n);
});

test('money addition rejects non-arrays, non-bigint elements and overflowing sums', () => {
  assert.equal(addMoneyMinor([125n, 0n, 5n]), 130n);
  for (const values of [null, undefined, {}, '123', 123]) {
    assert.throws(() => addMoneyMinor(values as never), PricingValidationError);
  }
  for (const value of [null, undefined, 1, '1', false, {}, [], Symbol('1')]) {
    assert.throws(() => addMoneyMinor([value as never]), PricingValidationError);
  }
  assert.throws(() => addMoneyMinor([-1n]), PricingValidationError);
  assert.throws(() => addMoneyMinor([9_000_000_000_000_000n, 1n]), PricingValidationError);
});
