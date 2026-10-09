import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPaymentReceiptBookingSnapshot,
  buildCustomerSettlementEntries,
  buildPaymentReceiptNumber,
  PaymentReceiptEvidenceError,
  sanitizeSuccessfulPaymentTransactions,
  summarizeSuccessfulPaymentActivity,
} from './payment-receipt-domain.ts';

const createdAt = new Date('2026-09-03T00:00:00Z');

function transaction(overrides: Partial<{
  id: string;
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
  status: string;
  providerCode: string;
  providerReference: string | null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}> = {}) {
  return {
    id: 'payment-1',
    kind: 'CAPTURE' as const,
    status: 'SUCCEEDED',
    providerCode: 'stripe',
    providerReference: 'pi_123',
    currency: 'USD',
    amountMinor: 10000n,
    createdAt,
    ...overrides,
  };
}

test('receipt number is deterministic and contains no UUID separators', () => {
  assert.equal(buildPaymentReceiptNumber('123e4567-e89b-12d3-a456-426614174000'), 'SF-123E4567E89B12D3');
});

test('sanitizer returns only successful activity and hides internal claim references', () => {
  const result = sanitizeSuccessfulPaymentTransactions([
    transaction({ id: 'pending', status: 'PENDING' }),
    transaction({ id: 'claim', providerReference: 'sf_claim_private' }),
    transaction({ id: 'real', providerReference: 'pi_real' }),
  ], 'USD');

  assert.deepEqual(result.map((item) => [item.id, item.providerReference]), [
    ['claim', null],
    ['real', 'pi_real'],
  ]);
});

test('sanitizer fails closed on successful currency drift or non-positive money', () => {
  assert.throws(
    () => sanitizeSuccessfulPaymentTransactions([transaction({ currency: 'EUR' })], 'USD'),
    PaymentReceiptEvidenceError,
  );
  assert.throws(
    () => sanitizeSuccessfulPaymentTransactions([transaction({ amountMinor: 0n })], 'USD'),
    PaymentReceiptEvidenceError,
  );
});

test('settlement counts captures and refunds while excluding authorization holds', () => {
  const transactions = [
    transaction({ id: 'auth', kind: 'AUTHORIZATION' }),
    transaction({ id: 'capture', kind: 'CAPTURE' }),
    transaction({ id: 'refund', kind: 'REFUND', amountMinor: 2500n }),
  ];

  assert.deepEqual(summarizeSuccessfulPaymentActivity(transactions, 'PARTIALLY_REFUNDED'), {
    capturedMinor: 10000n,
    refundedMinor: 2500n,
    netPaidMinor: 7500n,
  });
});

test('settled direct authorization is used only when no capture or offline payment exists', () => {
  const auth = transaction({ id: 'auth', kind: 'AUTHORIZATION' });
  assert.equal(summarizeSuccessfulPaymentActivity([auth], 'PAID').capturedMinor, 10000n);
  assert.equal(summarizeSuccessfulPaymentActivity([auth], 'AUTHORIZED').capturedMinor, 0n);

  const capture = transaction({ id: 'capture', kind: 'CAPTURE', amountMinor: 6000n });
  assert.equal(summarizeSuccessfulPaymentActivity([auth, capture], 'PAID').capturedMinor, 6000n);
});

test('customer settlement activity excludes authorization holds and provider identifiers', () => {
  const entries = buildCustomerSettlementEntries([
    transaction({ id: 'auth', kind: 'AUTHORIZATION' }),
    transaction({ id: 'capture', kind: 'CAPTURE' }),
    transaction({ id: 'refund', kind: 'REFUND', amountMinor: 2500n }),
  ], 'PARTIALLY_REFUNDED');

  assert.deepEqual(entries, [
    { kind: 'PAYMENT', amountMinor: 10000n, createdAt },
    { kind: 'REFUND', amountMinor: 2500n, createdAt },
  ]);
  assert.equal(Object.hasOwn(entries[0], 'providerReference'), false);
});

test('customer settlement activity exposes direct-settlement authorization as payment evidence', () => {
  const auth = transaction({ id: 'auth', kind: 'AUTHORIZATION', amountMinor: 9000n });
  assert.deepEqual(buildCustomerSettlementEntries([auth], 'PAID'), [
    { kind: 'PAYMENT', amountMinor: 9000n, createdAt },
  ]);
});

const receiptBookingSnapshot = {
  arrivalDate: new Date('2026-10-10T00:00:00Z'),
  departureDate: new Date('2026-10-12T00:00:00Z'),
  accommodationSubtotalMinor: 10000n,
  taxTotalMinor: 1000n,
  feeTotalMinor: 0n,
  addonTotalMinor: 0n,
  totalMinor: 11000n,
};

test('receipt booking evidence requires exact nonnegative component arithmetic', () => {
  assert.doesNotThrow(() => assertPaymentReceiptBookingSnapshot(receiptBookingSnapshot));
  for (const change of [
    { totalMinor: 10999n },
    { accommodationSubtotalMinor: -1n },
    { taxTotalMinor: -1n },
    { totalMinor: 0n },
    { feeTotalMinor: '0' as unknown as bigint },
  ]) {
    assert.throws(() => assertPaymentReceiptBookingSnapshot({ ...receiptBookingSnapshot, ...change }), PaymentReceiptEvidenceError);
  }
});

test('receipt booking evidence rejects invalid, reversed or zero-night stays', () => {
  for (const change of [
    { departureDate: receiptBookingSnapshot.arrivalDate },
    { departureDate: new Date('2026-10-09T00:00:00Z') },
    { arrivalDate: new Date('invalid') },
  ]) {
    assert.throws(() => assertPaymentReceiptBookingSnapshot({ ...receiptBookingSnapshot, ...change }), PaymentReceiptEvidenceError);
  }
});
