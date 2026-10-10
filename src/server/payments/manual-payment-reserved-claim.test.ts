import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeManualPaymentReference } from './manual-payment-provider.ts';

test('manual payment and refund references cannot impersonate internal claims', () => {
  for (const reference of ['sf_claim_', 'sf_claim_pending', `sf_claim_${'a'.repeat(64)}`]) {
    assert.throws(() => normalizeManualPaymentReference(reference), /reserved internal claim prefix/i);
  }
  assert.equal(normalizeManualPaymentReference('Bank claim 123'), 'Bank claim 123');
});
