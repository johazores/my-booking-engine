import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AustralianBusinessNumberValidationError,
  isValidAustralianBusinessNumber,
  normalizeAustralianBusinessNumber,
} from './australian-business-number-domain.ts';

test('normalizes a valid ABN using the published modulus-89 checksum', () => {
  assert.equal(normalizeAustralianBusinessNumber('51 824 753 556'), '51824753556');
  assert.equal(normalizeAustralianBusinessNumber('12-004-021-809'), '12004021809');
});

test('rejects malformed or checksum-invalid ABNs', () => {
  assert.throws(() => normalizeAustralianBusinessNumber('12345678901'), AustralianBusinessNumberValidationError);
  assert.throws(() => normalizeAustralianBusinessNumber('5182475355'), AustralianBusinessNumberValidationError);
  assert.throws(() => normalizeAustralianBusinessNumber('ABN 51 824 753 556'), AustralianBusinessNumberValidationError);
  assert.equal(isValidAustralianBusinessNumber('51 824 753 556'), true);
  assert.equal(isValidAustralianBusinessNumber('12345678901'), false);
});
