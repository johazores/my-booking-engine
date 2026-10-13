import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveRentalLateReturnSettlement } from './rental-late-return-settlement-domain.ts';
const row = { kind: 'OFFLINE_PAYMENT' as const, status: 'SUCCEEDED' as const, providerCode: 'manual', providerReference: ' BAD', sourceProviderReference: null, currency: 'USD', amountMinor: 7500n, createdAt: new Date('2026-10-01T00:00:00Z') };
test('late-return rejects malformed references', () => {
  assert.equal(deriveRentalLateReturnSettlement({ feeMinor: 7500n, currency: 'USD', transactions: [row] }).reconciled, false);
});
