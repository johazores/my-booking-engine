import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveRentalSecurityBondSettlement } from './rental-security-bond-domain.ts';
const row = { kind: 'OFFLINE_PAYMENT' as const, status: 'SUCCEEDED' as const, providerCode: 'manual', providerReference: ' BAD', sourceProviderReference: null, currency: 'USD', amountMinor: 50000n, createdAt: new Date('2026-10-01T00:00:00Z') };
test('security bond rejects malformed references', () => {
  assert.equal(deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'USD', transactions: [row] }).reconciled, false);
});
