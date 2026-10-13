import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveRentalLateReturnSettlement } from './rental-late-return-settlement-domain.ts';
const row = { kind: 'OFFLINE_PAYMENT' as const, status: 'SUCCEEDED' as const, providerCode: 'manual', providerReference: 'PAY-1', sourceProviderReference: null, currency: 'USD', amountMinor: 7500n, createdAt: new Date('invalid') };
test('late-return rejects invalid retained payment timestamp', () => {
  assert.equal(deriveRentalLateReturnSettlement({ feeMinor: 7500n, currency: 'USD', transactions: [row] }).reconciled, false);
});
