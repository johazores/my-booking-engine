import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveRentalDamageSettlement } from './rental-damage-settlement-domain.ts';
const row = { kind: 'OFFLINE_PAYMENT' as const, status: 'SUCCEEDED' as const, providerCode: 'manual', providerReference: 'PAY-1', sourceProviderReference: null, currency: 'USD', amountMinor: 25000n, createdAt: new Date('2026-10-01T00:00:00Z') };
test('damage settlement fails closed on retained invalid identity or time', () => {
  for (const change of [{ providerReference: ' BAD' }, { createdAt: new Date('invalid') }, { sourceProviderReference: 'BAD ' }]) {
    assert.equal(deriveRentalDamageSettlement({ liableAmountMinor: 25000n, currency: 'USD', transactions: [{ ...row, ...change }] }).reconciled, false);
  }
});
