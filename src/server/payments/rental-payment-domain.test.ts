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

test('rental payment settlement distinguishes unpaid, paid, partial refund, and full refund', () => {
  assert.equal(requireReconciled(deriveRentalPaymentSettlement({ bookingTotalMinor: 10_000n, currency: 'USD', transactions: [] })).paymentState, 'UNPAID');
  assert.equal(requireReconciled(deriveRentalPaymentSettlement({ bookingTotalMinor: 10_000n, currency: 'USD', transactions: [payment] })).paymentState, 'PAID');
  assert.equal(requireReconciled(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [payment, { ...payment, kind: 'REFUND', providerReference: 'REF-1', sourceProviderReference: 'BANK-001', amountMinor: 2_500n }],
  })).paymentState, 'PARTIALLY_REFUNDED');
  assert.equal(requireReconciled(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [payment, { ...payment, kind: 'REFUND', providerReference: 'REF-2', sourceProviderReference: 'BANK-001', amountMinor: 10_000n }],
  })).paymentState, 'REFUNDED');
});

test('rental payment settlement fails closed on unresolved or over-settled history', () => {
  assert.equal(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [{ ...payment, status: 'AMBIGUOUS' }],
  }).reconciled, false);
  assert.equal(deriveRentalPaymentSettlement({
    bookingTotalMinor: 5_000n,
    currency: 'USD',
    transactions: [payment],
  }).reconciled, false);
  assert.equal(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [payment, { ...payment, providerReference: 'BANK-002' }],
  }).reconciled, false);
});

test('rental payment settlement rejects partial successful payments instead of misclassifying them as refunds', () => {
  const result = requireUnreconciled(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [{ ...payment, amountMinor: 5_000n }],
  }));
  assert.match(result.reason, /full authoritative booking total/i);
});

test('rental payment settlement rejects successful evidence outside the enabled manual offline contract', () => {
  const stripe = requireUnreconciled(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [{ ...payment, providerCode: 'stripe' }],
  }));
  assert.match(stripe.reason, /manual\/offline contract/i);

  const capture = requireUnreconciled(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [{ ...payment, kind: 'CAPTURE' }],
  }));
  assert.match(capture.reason, /manual\/offline contract/i);
});

test('rental payment idempotency is stable and operation-scoped', () => {
  const first = buildRentalPaymentIdempotencyKey({ kind: 'manual-payment', bookingId: '11111111-1111-4111-8111-111111111111', reference: 'BANK-001' });
  const replay = buildRentalPaymentIdempotencyKey({ kind: 'manual-payment', bookingId: '11111111-1111-4111-8111-111111111111', reference: 'BANK-001' });
  const refund = buildRentalPaymentIdempotencyKey({ kind: 'manual-refund', bookingId: '11111111-1111-4111-8111-111111111111', reference: 'BANK-001' });
  assert.equal(first, replay);
  assert.notEqual(first, refund);
  assert.match(first, /^rental:manual-payment:[a-f0-9]{48}$/);
});

test('rental payment request fingerprint binds tenant, operation, idempotency, source, and exact money', () => {
  const base = {
    organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    bookingId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'rental:manual-refund:' + 'a'.repeat(48),
    kind: 'REFUND' as const,
    providerCode: 'manual',
    providerReference: 'REF-001',
    sourceProviderReference: 'BANK-001',
    currency: 'USD',
    amountMinor: 10_000n,
  };
  const first = buildRentalPaymentRequestFingerprint(base);
  assert.equal(first, buildRentalPaymentRequestFingerprint(base));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, buildRentalPaymentRequestFingerprint({ ...base, organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
  assert.notEqual(first, buildRentalPaymentRequestFingerprint({ ...base, idempotencyKey: 'rental:manual-refund:' + 'b'.repeat(48) }));
  assert.notEqual(first, buildRentalPaymentRequestFingerprint({ ...base, sourceProviderReference: 'BANK-002' }));
  assert.notEqual(first, buildRentalPaymentRequestFingerprint({ ...base, amountMinor: 9_999n }));
  assert.notEqual(first, buildRentalPaymentRequestFingerprint({ ...base, kind: 'OFFLINE_PAYMENT', sourceProviderReference: null }));
});
