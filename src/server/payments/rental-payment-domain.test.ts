import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRentalPaymentIdempotencyKey, deriveRentalPaymentSettlement } from './rental-payment-domain.ts';

const payment = {
  kind: 'OFFLINE_PAYMENT' as const,
  status: 'SUCCEEDED' as const,
  providerCode: 'manual',
  providerReference: 'BANK-001',
  sourceProviderReference: null,
  currency: 'USD',
  amountMinor: 10_000n,
};

test('rental payment settlement distinguishes unpaid, paid, partial refund, and full refund', () => {
  assert.equal(deriveRentalPaymentSettlement({ bookingTotalMinor: 10_000n, currency: 'USD', transactions: [] }).paymentState, 'UNPAID');
  assert.equal(deriveRentalPaymentSettlement({ bookingTotalMinor: 10_000n, currency: 'USD', transactions: [payment] }).paymentState, 'PAID');
  assert.equal(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [payment, { ...payment, kind: 'REFUND', providerReference: 'REF-1', sourceProviderReference: 'BANK-001', amountMinor: 2_500n }],
  }).paymentState, 'PARTIALLY_REFUNDED');
  assert.equal(deriveRentalPaymentSettlement({
    bookingTotalMinor: 10_000n,
    currency: 'USD',
    transactions: [payment, { ...payment, kind: 'REFUND', providerReference: 'REF-2', sourceProviderReference: 'BANK-001', amountMinor: 10_000n }],
  }).paymentState, 'REFUNDED');
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
});

test('rental payment idempotency is stable and operation-scoped', () => {
  const first = buildRentalPaymentIdempotencyKey({ kind: 'manual-payment', bookingId: '11111111-1111-4111-8111-111111111111', reference: 'BANK-001' });
  const replay = buildRentalPaymentIdempotencyKey({ kind: 'manual-payment', bookingId: '11111111-1111-4111-8111-111111111111', reference: 'BANK-001' });
  const refund = buildRentalPaymentIdempotencyKey({ kind: 'manual-refund', bookingId: '11111111-1111-4111-8111-111111111111', reference: 'BANK-001' });
  assert.equal(first, replay);
  assert.notEqual(first, refund);
  assert.match(first, /^rental:manual-payment:[a-f0-9]{48}$/);
});
