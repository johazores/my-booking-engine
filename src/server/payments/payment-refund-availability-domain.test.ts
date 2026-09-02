import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveBookingRefundAvailability, type BookingRefundTransaction } from './payment-refund-availability-domain.ts';

function transaction(overrides: Partial<BookingRefundTransaction> = {}): BookingRefundTransaction {
  return { kind: 'CAPTURE', status: 'SUCCEEDED', providerCode: 'stripe', providerReference: 'pi_123', currency: 'AUD', amountMinor: 12_500n, ...overrides };
}
const booking = { status: 'CONFIRMED', paymentStatus: 'PAID', currency: 'AUD', totalMinor: 12_500n };

test('returns the remaining Stripe balance after a partial refund', () => {
  const result = deriveBookingRefundAvailability({ ...booking, paymentStatus: 'PARTIALLY_REFUNDED', transactions: [transaction(), transaction({ kind: 'REFUND', providerReference: 're_1', amountMinor: 2_500n })] });
  assert.deepEqual(result, { available: true, providerCode: 'stripe', currency: 'AUD', refundableMinor: 10_000n, requiresReference: false });
});

test('requires an external reference for manual refunds', () => {
  const result = deriveBookingRefundAvailability({ ...booking, transactions: [transaction({ kind: 'OFFLINE_PAYMENT', providerCode: 'manual', providerReference: 'receipt-1' })] });
  assert.deepEqual(result, { available: true, providerCode: 'manual', currency: 'AUD', refundableMinor: 12_500n, requiresReference: true });
});

test('an unresolved refund blocks another refund', () => {
  const result = deriveBookingRefundAvailability({ ...booking, transactions: [transaction(), transaction({ kind: 'REFUND', status: 'AMBIGUOUS', providerReference: 'sf_claim_retry', amountMinor: 2_500n })] });
  assert.deepEqual(result, { available: false, reason: 'A payment operation is still unresolved. Reconcile payment history before continuing.' });
});

test('an unresolved capture also blocks a refund', () => {
  const result = deriveBookingRefundAvailability({ ...booking, transactions: [transaction(), transaction({ kind: 'CAPTURE', status: 'PENDING', providerReference: 'sf_claim_pending', amountMinor: 2_500n })] });
  assert.deepEqual(result, { available: false, reason: 'A payment operation is still unresolved. Reconcile payment history before continuing.' });
});

test('keeps internal payment claims and under-settled bookings unavailable', () => {
  const internal = deriveBookingRefundAvailability({ ...booking, transactions: [transaction({ providerReference: `sf_claim_${'a'.repeat(64)}` })] });
  assert.equal(internal.available, false);
  const mismatch = deriveBookingRefundAvailability({ ...booking, transactions: [transaction({ amountMinor: 12_000n })] });
  assert.equal(mismatch.available, false);
});

test('accepts reconciled net settlement when historical gross money exceeds the current booking total', () => {
  const result = deriveBookingRefundAvailability({
    ...booking,
    transactions: [
      transaction({ amountMinor: 15_000n }),
      transaction({ kind: 'REFUND', providerReference: 're_adjustment', sourceProviderReference: 'pi_123', amountMinor: 2_500n }),
    ],
  });
  assert.deepEqual(result, { available: true, providerCode: 'stripe', currency: 'AUD', refundableMinor: 12_500n, requiresReference: false });
});

test('keeps mixed settled providers unavailable', () => {
  const result = deriveBookingRefundAvailability({
    ...booking,
    transactions: [
      transaction({ kind: 'OFFLINE_PAYMENT', providerCode: 'manual', providerReference: 'receipt-1', amountMinor: 6_000n }),
      transaction({ providerReference: 'pi_2', amountMinor: 6_500n }),
    ],
  });
  assert.equal(result.available, false);
  if (result.available) return;
  assert.match(result.reason, /multiple payment providers/i);
});

test('keeps multiple same-provider settlement sources unavailable until source-aware provider execution exists', () => {
  const result = deriveBookingRefundAvailability({
    ...booking,
    transactions: [transaction({ providerReference: 'pi_1', amountMinor: 6_000n }), transaction({ providerReference: 'pi_2', amountMinor: 6_500n })],
  });
  assert.equal(result.available, false);
  if (result.available) return;
  assert.match(result.reason, /deterministic allocation/i);
  assert.match(result.reason, /provider execution/i);
});

test('reconciles attributed multi-source refunds before stopping at the provider-execution boundary', () => {
  const result = deriveBookingRefundAvailability({
    ...booking,
    paymentStatus: 'PARTIALLY_REFUNDED',
    transactions: [
      transaction({ providerReference: 'pi_1', amountMinor: 6_000n }),
      transaction({ providerReference: 'pi_2', amountMinor: 6_500n }),
      transaction({ kind: 'REFUND', providerReference: 're_1', sourceProviderReference: 'pi_1', amountMinor: 1_000n }),
    ],
  });
  assert.equal(result.available, false);
  if (result.available) return;
  assert.match(result.reason, /provider execution/i);
});

test('rejects over-refunded histories instead of deriving a negative balance', () => {
  const result = deriveBookingRefundAvailability({ ...booking, transactions: [transaction(), transaction({ kind: 'REFUND', providerReference: 're_1', amountMinor: 13_000n })] });
  assert.equal(result.available, false);
  if (result.available) return;
  assert.match(result.reason, /exceeds settled money/i);
});

test('fails closed when booking payment status disagrees with successful refund history', () => {
  const result = deriveBookingRefundAvailability({
    ...booking,
    transactions: [transaction(), transaction({ kind: 'REFUND', providerReference: 're_1', amountMinor: 2_500n })],
  });
  assert.equal(result.available, false);
  if (result.available) return;
  assert.match(result.reason, /payment status is inconsistent/i);
});

test('partially refunded status requires a strictly positive balance below the booking total', () => {
  const result = deriveBookingRefundAvailability({
    ...booking,
    paymentStatus: 'PARTIALLY_REFUNDED',
    transactions: [transaction(), transaction({ kind: 'REFUND', providerReference: 're_all', amountMinor: 12_500n })],
  });
  assert.equal(result.available, false);
  if (result.available) return;
  assert.match(result.reason, /payment status is inconsistent/i);
});
