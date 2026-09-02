import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveBookingRefundExecutionPlan } from './payment-refund-execution-domain.ts';
import type { BookingSettlementTransaction } from './payment-settlement-domain.ts';

function transaction(overrides: Partial<BookingSettlementTransaction> = {}): BookingSettlementTransaction {
  return {
    kind: 'OFFLINE_PAYMENT',
    status: 'SUCCEEDED',
    providerCode: 'manual',
    providerReference: 'receipt-1',
    currency: 'AUD',
    amountMinor: 12_500n,
    ...overrides,
  };
}

test('plans a full single-source refund', () => {
  const result = deriveBookingRefundExecutionPlan({
    bookingPaymentStatus: 'PAID',
    bookingTotalMinor: 12_500n,
    currency: 'AUD',
    transactions: [transaction()],
  });
  assert.deepEqual(result, {
    planned: true,
    providerCode: 'manual',
    sourceProviderReference: 'receipt-1',
    sourceKind: 'OFFLINE_PAYMENT',
    currency: 'AUD',
    amountMinor: 12_500n,
    sourceRefundableMinor: 12_500n,
    bookingRefundableMinor: 12_500n,
    refundableSourceCount: 1,
    nextPaymentStatus: 'REFUNDED',
  });
});

test('selects one deterministic source at a time for a multi-source refund', () => {
  const result = deriveBookingRefundExecutionPlan({
    bookingPaymentStatus: 'PAID',
    bookingTotalMinor: 12_500n,
    currency: 'AUD',
    transactions: [
      transaction({ providerReference: 'receipt-small', amountMinor: 5_000n }),
      transaction({ providerReference: 'receipt-large', amountMinor: 7_500n }),
    ],
  });
  assert.equal(result.planned, true);
  if (!result.planned) return;
  assert.equal(result.sourceProviderReference, 'receipt-large');
  assert.equal(result.amountMinor, 7_500n);
  assert.equal(result.bookingRefundableMinor, 12_500n);
  assert.equal(result.refundableSourceCount, 2);
  assert.equal(result.nextPaymentStatus, 'PARTIALLY_REFUNDED');
});

test('continues to the next source after an attributed refund', () => {
  const result = deriveBookingRefundExecutionPlan({
    bookingPaymentStatus: 'PARTIALLY_REFUNDED',
    bookingTotalMinor: 12_500n,
    currency: 'AUD',
    transactions: [
      transaction({ providerReference: 'receipt-a', amountMinor: 5_000n }),
      transaction({ providerReference: 'receipt-b', amountMinor: 7_500n }),
      transaction({ kind: 'REFUND', providerReference: 'refund-b', sourceProviderReference: 'receipt-b', amountMinor: 7_500n }),
    ],
  });
  assert.equal(result.planned, true);
  if (!result.planned) return;
  assert.equal(result.sourceProviderReference, 'receipt-a');
  assert.equal(result.amountMinor, 5_000n);
  assert.equal(result.nextPaymentStatus, 'REFUNDED');
});

test('explicit refund cannot silently span multiple settlement sources', () => {
  const result = deriveBookingRefundExecutionPlan({
    bookingPaymentStatus: 'PAID',
    bookingTotalMinor: 12_500n,
    currency: 'AUD',
    requestedAmountMinor: 10_000n,
    transactions: [
      transaction({ providerReference: 'receipt-a', amountMinor: 5_000n }),
      transaction({ providerReference: 'receipt-b', amountMinor: 7_500n }),
    ],
  });
  assert.equal(result.planned, false);
  if (result.planned) return;
  assert.match(result.reason, /split the refund across settlement sources/i);
});

test('fails closed on unresolved operations and payment-state drift', () => {
  const unresolved = deriveBookingRefundExecutionPlan({
    bookingPaymentStatus: 'PAID',
    bookingTotalMinor: 12_500n,
    currency: 'AUD',
    transactions: [transaction(), transaction({ kind: 'REFUND', status: 'PENDING', providerReference: 'pending', amountMinor: 100n })],
  });
  assert.equal(unresolved.planned, false);

  const drift = deriveBookingRefundExecutionPlan({
    bookingPaymentStatus: 'PAID',
    bookingTotalMinor: 12_500n,
    currency: 'AUD',
    transactions: [transaction(), transaction({ kind: 'REFUND', providerReference: 'refund-1', sourceProviderReference: 'receipt-1', amountMinor: 100n })],
  });
  assert.equal(drift.planned, false);
  if (!drift.planned) assert.match(drift.reason, /payment status is inconsistent/i);
});

test('expected provider prevents crossing the wrong adapter boundary', () => {
  const result = deriveBookingRefundExecutionPlan({
    bookingPaymentStatus: 'PAID',
    bookingTotalMinor: 12_500n,
    currency: 'AUD',
    expectedProviderCode: 'stripe',
    transactions: [transaction()],
  });
  assert.equal(result.planned, false);
  if (result.planned) return;
  assert.match(result.reason, /manual, not stripe/i);
});
