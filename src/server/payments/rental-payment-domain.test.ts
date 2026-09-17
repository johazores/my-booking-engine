import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalPaymentIdempotencyKey,
  buildRentalPaymentRequestFingerprint,
  deriveRentalPaymentSettlement,
} from './rental-payment-domain.ts';

const payment = {
  kind: 'OFFLINE_PAYMENT' as const,
  status: 'SUCCEEDED' as const,
  providerCode: 'manual',
  providerReference: 'BANK-001',
  sourceProviderReference: null,
  currency: 'USD',
  amountMinor: 10_000n,
};

function requireReconciled(result: ReturnType<typeof deriveRentalPaymentSettlement>) {
  if (!result.reconciled) throw new Error(result.reason);
  return result;
}
function requireUnreconciled(result: ReturnType<typeof deriveRentalPaymentSettlement>) {
  if (result.reconciled) throw new Error('Expected rental payment settlement to fail closed.');
  return result;
}

test('rental payment settlement distinguishes unpaid, partial funding, paid, partial refund, and full refund', () => {
  const unpaid = requireReconciled(deriveRentalPaymentSettlement({ bookingTotalMinor: 10_000n, currency: 'USD', transactions: [] }));
  assert.equal(unpaid.paymentState, 'UNPAID');
  assert.equal(unpaid.outstandingMinor, 10_000n);

  const partial = requireReconciled(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [{ ...payment, amountMinor: 4_000n }],
  }));
  assert.equal(partial.paymentState, 'PARTIALLY_PAID');
  assert.equal(partial.netSettledMinor, 4_000n);
  assert.equal(partial.outstandingMinor, 6_000n);
  assert.equal(partial.nextRefundableSourceMinor, 4_000n);

  const paid = requireReconciled(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [
      { ...payment, amountMinor: 4_000n },
      { ...payment, providerReference: 'BANK-002', amountMinor: 6_000n },
    ],
  }));
  assert.equal(paid.paymentState, 'PAID');
  assert.equal(paid.outstandingMinor, 0n);
  assert.equal(paid.nextRefundableSourceMinor, 6_000n);

  const partiallyRefunded = requireReconciled(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [
      { ...payment, amountMinor: 4_000n },
      { ...payment, providerReference: 'BANK-002', amountMinor: 6_000n },
      { ...payment, kind: 'REFUND', providerReference: 'REF-1', sourceProviderReference: 'BANK-002', amountMinor: 2_000n },
    ],
  }));
  assert.equal(partiallyRefunded.paymentState, 'PARTIALLY_REFUNDED');
  assert.equal(partiallyRefunded.netSettledMinor, 8_000n);
  assert.equal(partiallyRefunded.outstandingMinor, 2_000n);
  assert.equal(partiallyRefunded.nextRefundableSourceMinor, 4_000n);

  const refunded = requireReconciled(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [
      { ...payment, amountMinor: 4_000n },
      { ...payment, providerReference: 'BANK-002', amountMinor: 6_000n },
      { ...payment, kind: 'REFUND', providerReference: 'REF-1', sourceProviderReference: 'BANK-001', amountMinor: 4_000n },
      { ...payment, kind: 'REFUND', providerReference: 'REF-2', sourceProviderReference: 'BANK-002', amountMinor: 6_000n },
    ],
  }));
  assert.equal(refunded.paymentState, 'REFUNDED');
  assert.equal(refunded.netSettledMinor, 0n);
  assert.equal(refunded.outstandingMinor, 10_000n);
  assert.equal(refunded.nextRefundableSourceMinor, 0n);
});

test('rental payment settlement supports replacement funding after a source refund while capping net settlement', () => {
  const replacement = requireReconciled(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [
      { ...payment, amountMinor: 4_000n },
      { ...payment, kind: 'REFUND', providerReference: 'REF-1', sourceProviderReference: 'BANK-001', amountMinor: 2_000n },
      { ...payment, providerReference: 'BANK-002', amountMinor: 8_000n },
    ],
  }));
  assert.equal(replacement.grossSettledMinor, 12_000n);
  assert.equal(replacement.refundedMinor, 2_000n);
  assert.equal(replacement.netSettledMinor, 10_000n);
  assert.equal(replacement.paymentState, 'PAID');

  const overfunded = requireUnreconciled(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [payment, { ...payment, providerReference: 'BANK-002' }],
  }));
  assert.match(overfunded.reason, /authoritative booking total/i);
});

test('rental payment settlement fails closed on unresolved or unsupported successful evidence', () => {
  assert.equal(deriveRentalPaymentSettlement({ bookingTotalMinor: 10_000n, currency: 'USD', transactions: [{ ...payment, status: 'AMBIGUOUS' }] }).reconciled, false);
  const stripe = requireUnreconciled(deriveRentalPaymentSettlement({ bookingTotalMinor: 10_000n, currency: 'USD', transactions: [{ ...payment, providerCode: 'stripe' }] }));
  assert.match(stripe.reason, /manual\/offline contract/i);
  const capture = requireUnreconciled(deriveRentalPaymentSettlement({ bookingTotalMinor: 10_000n, currency: 'USD', transactions: [{ ...payment, kind: 'CAPTURE' }] }));
  assert.match(capture.reason, /manual\/offline contract/i);
});

test('rental payment idempotency is stable and operation-scoped', () => {
  const first = buildRentalPaymentIdempotencyKey({ kind: 'manual-payment', bookingId: '11111111-1111-4111-8111-111111111111', reference: 'BANK-001' });
  const replay = buildRentalPaymentIdempotencyKey({ kind: 'manual-payment', bookingId: '11111111-1111-4111-8111-111111111111', reference: 'BANK-001' });
  const refund = buildRentalPaymentIdempotencyKey({ kind: 'manual-refund', bookingId: '11111111-1111-4111-8111-111111111111', reference: 'BANK-001' });
  assert.equal(first, replay); assert.notEqual(first, refund); assert.match(first, /^rental:manual-payment:[a-f0-9]{48}$/);
});

test('rental payment request fingerprint binds tenant, operation, idempotency, source, and exact money', () => {
  const base = { organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', bookingId: '11111111-1111-4111-8111-111111111111', idempotencyKey: 'rental:manual-refund:' + 'a'.repeat(48), kind: 'REFUND' as const, providerCode: 'manual', providerReference: 'REF-001', sourceProviderReference: 'BANK-001', currency: 'USD', amountMinor: 10_000n };
  const first = buildRentalPaymentRequestFingerprint(base);
  assert.equal(first, buildRentalPaymentRequestFingerprint(base)); assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, buildRentalPaymentRequestFingerprint({ ...base, organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
  assert.notEqual(first, buildRentalPaymentRequestFingerprint({ ...base, amountMinor: 9_999n }));
  assert.notEqual(first, buildRentalPaymentRequestFingerprint({ ...base, kind: 'OFFLINE_PAYMENT', sourceProviderReference: null }));
});
