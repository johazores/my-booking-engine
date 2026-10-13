import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveRentalSecurityBondSettlement as derive } from './rental-security-bond-domain.ts';
const row = { kind: 'OFFLINE_PAYMENT' as const, status: 'SUCCEEDED' as const, providerCode: 'manual', providerReference: 'BOND', sourceProviderReference: null, currency: 'PHP', amountMinor: 1n, createdAt: new Date() };
test('bond rejects invalid forfeiture timestamp', () => {
  assert.equal(derive({ requiredAmountMinor: 1n, currency: 'PHP', transactions: [row], forfeiture: { liabilityDecisionId: 'x', currency: 'PHP', amountMinor: 1n, createdAt: new Date('invalid') } }).reconciled, false);
});
