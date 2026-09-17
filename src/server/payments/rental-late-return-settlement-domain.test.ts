import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalLateReturnSettlementIdempotencyKey,
  buildRentalLateReturnSettlementRequestFingerprint,
  deriveRentalLateReturnSettlement,
} from './rental-late-return-settlement-domain.ts';

const createdAt = new Date('2026-09-17T08:20:00.000Z');
const payment = {
  kind: 'OFFLINE_PAYMENT' as const,
  status: 'SUCCEEDED' as const,
  providerCode: 'manual',
  providerReference: 'LATE-PAY-1',
  sourceProviderReference: null,
  currency: 'USD',
  amountMinor: 7500n,
  createdAt,
};

test('late-return settlement reconciles unpaid, paid, and fully refunded evidence', () => {
  assert.equal(deriveRentalLateReturnSettlement({ feeMinor: 7500n, currency: 'USD', transactions: [] }).state, 'UNPAID');
  assert.equal(deriveRentalLateReturnSettlement({ feeMinor: 7500n, currency: 'USD', transactions: [payment] }).state, 'PAID');
  const refund = {
    ...payment,
    kind: 'REFUND' as const,
    providerReference: 'LATE-REFUND-1',
    sourceProviderReference: payment.providerReference,
    createdAt: new Date(createdAt.getTime() + 1),
  };
  assert.equal(deriveRentalLateReturnSettlement({ feeMinor: 7500n, currency: 'USD', transactions: [payment, refund] }).state, 'REFUNDED');
});

test('late-return settlement fails closed for wrong amount, source, chronology, or unsupported history', () => {
  assert.equal(deriveRentalLateReturnSettlement({ feeMinor: 7500n, currency: 'USD', transactions: [{ ...payment, amountMinor: 7499n }] }).reconciled, false);
  const badRefund = {
    ...payment,
    kind: 'REFUND' as const,
    providerReference: 'LATE-REFUND-1',
    sourceProviderReference: 'OTHER',
    createdAt: new Date(createdAt.getTime() - 1),
  };
  assert.equal(deriveRentalLateReturnSettlement({ feeMinor: 7500n, currency: 'USD', transactions: [payment, badRefund] }).reconciled, false);
  assert.equal(deriveRentalLateReturnSettlement({ feeMinor: 0n, currency: 'USD', transactions: [] }).reconciled, false);
});

test('late-return settlement idempotency and request evidence are deterministic and operation-bound', () => {
  const assessmentId = '11111111-1111-4111-8111-111111111111';
  const first = buildRentalLateReturnSettlementIdempotencyKey({ kind: 'manual-payment', assessmentId, reference: 'LATE-PAY-1' });
  const replay = buildRentalLateReturnSettlementIdempotencyKey({ kind: 'manual-payment', assessmentId, reference: 'LATE-PAY-1' });
  const refund = buildRentalLateReturnSettlementIdempotencyKey({ kind: 'manual-refund', assessmentId, reference: 'LATE-PAY-1' });
  assert.equal(first, replay);
  assert.notEqual(first, refund);
  assert.match(first, /^rental-late-return:manual-payment:[a-f0-9]{48}$/);

  const base = {
    organizationId: '22222222-2222-4222-8222-222222222222',
    bookingId: '33333333-3333-4333-8333-333333333333',
    assessmentId,
    idempotencyKey: first,
    kind: 'OFFLINE_PAYMENT' as const,
    providerCode: 'manual',
    providerReference: 'LATE-PAY-1',
    sourceProviderReference: null,
    currency: 'USD',
    amountMinor: 7500n,
  };
  const fingerprint = buildRentalLateReturnSettlementRequestFingerprint(base);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(fingerprint, buildRentalLateReturnSettlementRequestFingerprint({ ...base, amountMinor: 7501n }));
});
