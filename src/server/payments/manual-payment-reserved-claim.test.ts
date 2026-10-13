import assert from 'node:assert/strict';
import test from 'node:test';

import { isCanonicalManualPaymentReference, normalizeManualPaymentReference } from './manual-payment-provider.ts';

test('manual payment and refund references cannot impersonate internal claims', () => {
  for (const reference of ['sf_claim_', 'sf_claim_pending', `sf_claim_${'a'.repeat(64)}`]) {
    assert.throws(() => normalizeManualPaymentReference(reference), /reserved internal claim prefix/i);
  }
  assert.equal(normalizeManualPaymentReference('Bank claim 123'), 'Bank claim 123');
});


test('retained manual references must be canonical and cannot be silently normalized', () => {
  for (const reference of ['Bank claim 123', 'REF-1/abc#123', 'A'.repeat(120)]) {
    assert.equal(isCanonicalManualPaymentReference(reference), true);
  }
  for (const reference of [null, 42, '', ' REF-1', 'REF-1 ', 'REF-1\n', 'sf_claim_pending',
    'REF-🚀', 'A'.repeat(121)]) {
    assert.equal(isCanonicalManualPaymentReference(reference), false);
  }
});
