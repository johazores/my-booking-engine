import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePricingFingerprint, normalizePricingPagination, requirePricingObjectText, requirePricingText } from './pricing-boundary.ts';
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

test('pricing service scope fields reject malformed nested payloads before persistence', () => {
  const valid = { propertyId: ' 11111111-1111-4111-8111-111111111111 ', roomTypeId: ' room ', ratePlanId: ' plan ' };
  assert.equal(requirePricingObjectText(valid, 'propertyId', 'Property ID'), '11111111-1111-4111-8111-111111111111');
  assert.equal(requirePricingObjectText(valid, 'roomTypeId', 'Room type ID'), 'room');
  for (const value of [null, undefined, 0, false, '', [], {}, { propertyId: null }, { propertyId: [] }, { propertyId: 7 }]) {
    assert.throws(() => requirePricingObjectText(value, 'propertyId', 'Property ID'), PricingValidationError);
  }
});
