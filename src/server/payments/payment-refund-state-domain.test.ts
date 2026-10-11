import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveBookingPaymentStatusFromNetSettlement,
  deriveBookingPaymentStatusFromSettlementTransactions,
} from './payment-refund-state-domain.ts';

test('derives paid from exact net settlement', () => {
  assert.deepEqual(deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 12_500n, netSettledMinor: 12_500n }), {
    reconciled: true,
    paymentStatus: 'PAID',
  });
});

test('derives partially refunded from a positive balance below total', () => {
  assert.deepEqual(deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 12_500n, netSettledMinor: 10_000n }), {
    reconciled: true,
    paymentStatus: 'PARTIALLY_REFUNDED',
  });
});

test('derives refunded from zero net settlement', () => {
  assert.deepEqual(deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 12_500n, netSettledMinor: 0n }), {
    reconciled: true,
    paymentStatus: 'REFUNDED',
  });
});

test('derives booking payment state from a source-attributed multi-settlement ledger', () => {
  const result = deriveBookingPaymentStatusFromSettlementTransactions({
    bookingTotalMinor: 12_500n,
    currency: 'AUD',
    transactions: [
      { kind: 'CAPTURE', status: 'SUCCEEDED', providerCode: 'stripe', providerReference: 'pi_a', currency: 'AUD', amountMinor: 6_000n },
      { kind: 'CAPTURE', status: 'SUCCEEDED', providerCode: 'stripe', providerReference: 'pi_b', currency: 'AUD', amountMinor: 6_500n },
      { kind: 'REFUND', status: 'SUCCEEDED', providerCode: 'stripe', providerReference: 're_b', sourceProviderReference: 'pi_b', currency: 'AUD', amountMinor: 2_500n },
    ],
  });
  assert.deepEqual(result, { reconciled: true, paymentStatus: 'PARTIALLY_REFUNDED' });
});

test('ledger payment-state derivation fails closed while any operation is unresolved', () => {
  const result = deriveBookingPaymentStatusFromSettlementTransactions({
    bookingTotalMinor: 12_500n,
    currency: 'AUD',
    transactions: [
      { kind: 'CAPTURE', status: 'SUCCEEDED', providerCode: 'stripe', providerReference: 'pi_a', currency: 'AUD', amountMinor: 12_500n },
      { kind: 'REFUND', status: 'PENDING', providerCode: 'stripe', providerReference: 're_pending', sourceProviderReference: 'pi_a', currency: 'AUD', amountMinor: 2_500n },
    ],
  });
  assert.equal(result.reconciled, false);
  if (result.reconciled) return;
  assert.match(result.reason, /still unresolved/i);
});

test('fails closed when net settlement exceeds the booking total', () => {
  const result = deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 12_500n, netSettledMinor: 12_501n });
  assert.equal(result.reconciled, false);
});

test('fails closed for negative net settlement', () => {
  const result = deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 12_500n, netSettledMinor: -1n });
  assert.equal(result.reconciled, false);
});

test('fails closed for a non-positive booking total', () => {
  const result = deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 0n, netSettledMinor: 0n });
  assert.equal(result.reconciled, false);
});


test('ledger payment state does not confuse missing settlement with a completed refund', () => {
  for (const transactions of [
    [],
    [{ kind: 'CAPTURE' as const, status: 'FAILED' as const, providerCode: 'stripe', providerReference: 'pi_failed', currency: 'AUD', amountMinor: 12_500n }],
  ]) {
    const result = deriveBookingPaymentStatusFromSettlementTransactions({ bookingTotalMinor: 12_500n, currency: 'AUD', transactions });
    assert.equal(result.reconciled, false);
    if (!result.reconciled) assert.match(result.reason, /no successful received payment/i);
  }
  const fullyRefunded = deriveBookingPaymentStatusFromSettlementTransactions({
    bookingTotalMinor: 12_500n,
    currency: 'AUD',
    transactions: [
      { kind: 'CAPTURE', status: 'SUCCEEDED', providerCode: 'stripe', providerReference: 'pi_paid', currency: 'AUD', amountMinor: 12_500n },
      { kind: 'REFUND', status: 'SUCCEEDED', providerCode: 'stripe', providerReference: 're_paid', sourceProviderReference: 'pi_paid', currency: 'AUD', amountMinor: 12_500n },
    ],
  });
  assert.deepEqual(fullyRefunded, { reconciled: true, paymentStatus: 'REFUNDED' });
});

test('net settlement rejects malformed money types instead of coercing values', () => {
  for (const bookingTotalMinor of ['12500', 12500, null, undefined]) {
    const result = deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: bookingTotalMinor as unknown as bigint, netSettledMinor: 0n });
    assert.equal(result.reconciled, false);
  }
  for (const netSettledMinor of ['0', 0, null, undefined]) {
    const result = deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 12_500n, netSettledMinor: netSettledMinor as unknown as bigint });
    assert.equal(result.reconciled, false);
  }
});
