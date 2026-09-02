import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveBookingRefundAvailability, type BookingRefundTransaction } from './payment-refund-availability-domain.ts';

function transaction(overrides: Partial<BookingRefundTransaction> = {}): BookingRefundTransaction {
  return {
    kind: 'CAPTURE',
    status: 'SUCCEEDED',
    providerCode: 'stripe',
    providerReference: 'pi_123',
    currency: 'AUD',
    amountMinor: 12_500n,
    ...overrides,
  };
}

const booking = {
  status: 'CONFIRMED',
  paymentStatus: 'PAID',
  currency: 'AUD',
  totalMinor: 12_500n,
};

test('refund availability exposes remaining Stripe settlement without leaking provider reference', () => {
  const result = deriveBookingRefundAvailability({
    ...booking,
    paymentStatus: 'PARTIALLY_REFUNDED',
    transactions: [transaction(), transaction({ kind: 'REFUND', providerReference: 're_1', amountMinor: 2_500n })],
  });
  assert.deepEqual(result, {
    available: true,
    providerCode: 'stripe',
    currency: 'AUD',
    refundableMinor: 10_000n,
    requiresReference: false,
  });
});

test('manual refunds require an external refund reference', () => {
  const result = deriveBookingRefundAvailability({
    ...booking,
    transactions: [transaction({ kind: 'OFFLINE_PAYMENT', providerCode: 'manual', providerReference: 'bank-123' })],
  });
  assert.equal(result.available, true);
  if (result.available) {
    assert.equal(result.providerCode, 'manual');
    assert.equal(result.requiresReference, true);
  }
});

test('unresolved refunds block a second refund regardless of provider', () => {
  const result = deriveBookingRefundAvailability({
    ...booking,
    transactions: [transaction(), transaction({ kind: 'REFUND', status: 'AMBIGUOUS', providerReference: 'sf_claim_refund' })],
  });
  assert.deepEqual(result, {
    available: false,
    reason: 'An earlier refund is still unresolved. Reconcile it before starting another refund.',
  });
});

test('internal Stripe claims and mismatched settlements cannot become refund authority', () => {
  const claim = deriveBookingRefundAvailability({ ...booking, transactions: [transaction({ providerReference: 'sf_claim_123' })] });
  assert.equal(claim.available, false);

  const mismatch = deriveBookingRefundAvailability({ ...booking, transactions: [transaction({ amountMinor: 10_000n })] });
  assert.equal(mismatch.available, false);
});

test('mixed settled providers are rejected instead of choosing one implicitly', () => {
  const result = deriveBookingRefundAvailability({
    ...booking,
    transactions: [
      transaction(),
      transaction({ kind: 'OFFLINE_PAYMENT', providerCode: 'manual', providerReference: 'bank-123' }),
    ],
  });
  assert.equal(result.available, false);
  if (!result.available) assert.match(result.reason, /multiple payment providers/i);
});

test('over-refunded history fails closed instead of exposing a negative balance', () => {
  const result = deriveBookingRefundAvailability({
    ...booking,
    paymentStatus: 'PARTIALLY_REFUNDED',
    transactions: [transaction(), transaction({ kind: 'REFUND', providerReference: 're_over', amountMinor: 13_000n })],
  });
  assert.equal(result.available, false);
  if (!result.available) assert.match(result.reason, /inconsistent/i);
});
