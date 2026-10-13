import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveRentalSecurityBondSettlement } from './rental-security-bond-domain.ts';
const row = { kind: 'OFFLINE_PAYMENT' as const, status: 'SUCCEEDED' as const, providerCode: 'manual', providerReference: 'BOND-1', sourceProviderReference: null, currency: 'PHP', amountMinor: 50000n, createdAt: new Date('invalid') };
test('security bond rejects invalid retained collection timestamp', () => {
  assert.equal(deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [row] }).reconciled, false);
});
