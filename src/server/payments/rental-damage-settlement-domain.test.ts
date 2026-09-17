import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalDamageSettlementIdempotencyKey,
  buildRentalDamageSettlementRequestFingerprint,
  deriveRentalDamageSettlement,
} from './rental-damage-settlement-domain.ts';

const createdAt = new Date('2026-09-17T01:30:00.000Z');
const payment = {
  kind: 'OFFLINE_PAYMENT' as const,
  status: 'SUCCEEDED' as const,
  providerCode: 'manual',
  providerReference: 'DAMAGE-PAY-1',
  sourceProviderReference: null,
  currency: 'USD',
  amountMinor: 25000n,
  createdAt,
};

test('damage settlement reconciles unpaid, paid, and fully refunded evidence', () => {
  assert.equal(deriveRentalDamageSettlement({ liableAmountMinor: 25000n, currency: 'USD', transactions: [] }).state, 'UNPAID');
  assert.equal(deriveRentalDamageSettlement({ liableAmountMinor: 25000n, currency: 'USD', transactions: [payment] }).state, 'PAID');
  const refund = {
    ...payment,
    kind: 'REFUND' as const,
    providerReference: 'DAMAGE-REFUND-1',
    sourceProviderReference: payment.providerReference,
    createdAt: new Date(createdAt.getTime() + 1),
  };
  assert.equal(deriveRentalDamageSettlement({ liableAmountMinor: 25000n, currency: 'USD', transactions: [payment, refund] }).state, 'REFUNDED');
});

test('damage settlement fails closed for wrong amount, source, or chronology', () => {
  const wrongAmount = { ...payment, amountMinor: 24999n };
  assert.equal(deriveRentalDamageSettlement({ liableAmountMinor: 25000n, currency: 'USD', transactions: [wrongAmount] }).reconciled, false);

  const badRefund = {
    ...payment,
    kind: 'REFUND' as const,
    providerReference: 'DAMAGE-REFUND-1',
    sourceProviderReference: 'OTHER',
    createdAt: new Date(createdAt.getTime() - 1),
  };
  assert.equal(deriveRentalDamageSettlement({ liableAmountMinor: 25000n, currency: 'USD', transactions: [payment, badRefund] }).reconciled, false);
});

test('damage settlement idempotency and request evidence are deterministic and operation-bound', () => {
  const liabilityDecisionId = '11111111-1111-4111-8111-111111111111';
  const first = buildRentalDamageSettlementIdempotencyKey({ kind: 'manual-payment', liabilityDecisionId, reference: 'DAMAGE-PAY-1' });
  const replay = buildRentalDamageSettlementIdempotencyKey({ kind: 'manual-payment', liabilityDecisionId, reference: 'DAMAGE-PAY-1' });
  const refund = buildRentalDamageSettlementIdempotencyKey({ kind: 'manual-refund', liabilityDecisionId, reference: 'DAMAGE-PAY-1' });
  assert.equal(first, replay);
  assert.notEqual(first, refund);
  assert.match(first, /^rental-damage:manual-payment:[a-f0-9]{48}$/);

  const base = {
    organizationId: '22222222-2222-4222-8222-222222222222',
    bookingId: '33333333-3333-4333-8333-333333333333',
    damageCaseId: '44444444-4444-4444-8444-444444444444',
    liabilityDecisionId,
    idempotencyKey: first,
    kind: 'OFFLINE_PAYMENT' as const,
    providerCode: 'manual',
    providerReference: 'DAMAGE-PAY-1',
    sourceProviderReference: null,
    currency: 'USD',
    amountMinor: 25000n,
  };
  const fingerprint = buildRentalDamageSettlementRequestFingerprint(base);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(fingerprint, buildRentalDamageSettlementRequestFingerprint({ ...base, amountMinor: 25001n }));
});
