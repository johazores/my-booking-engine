import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePricingFingerprint, normalizePricingPagination, requirePricingText } from './pricing-boundary.ts';
import { PricingValidationError } from './money.ts';

test('bounds pricing pagination defensively inside the service layer', () => {
  assert.deepEqual(normalizePricingPagination(-10, 0), { page: 1, pageSize: 20 });
  assert.deepEqual(normalizePricingPagination(3, 500), { page: 3, pageSize: 50 });
  assert.deepEqual(normalizePricingPagination(2, 25), { page: 2, pageSize: 25 });
});

test('normalizes and validates deterministic pricing fingerprints', () => {
  const fingerprint = 'A'.repeat(64);
  assert.equal(normalizePricingFingerprint(` ${fingerprint} `), 'a'.repeat(64));
  assert.throws(() => normalizePricingFingerprint('not-a-fingerprint'), /64-character SHA-256/);
  assert.throws(() => normalizePricingFingerprint('g'.repeat(64)), /64-character SHA-256/);
});

test('pricing text and fingerprint readers reject non-string runtime scalars', () => {
  for (const value of [null, undefined, 7, true, {}, [], Symbol('bad')]) {
    assert.throws(() => requirePricingText(value, 'Code'), PricingValidationError);
    assert.throws(() => normalizePricingFingerprint(value as never), PricingValidationError);
  }
});
