import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveBookingPaymentStatusFromSettlementTransactions } from './payment-refund-state-domain.ts';

const partialPayment = {
  kind: 'CAPTURE' as const,
  status: 'SUCCEEDED' as const,
  providerCode: 'stripe',
  providerReference: 'pi_partial',
  currency: 'AUD',
  amountMinor: 8_000n,
};

test('partial funding alone cannot establish a partially refunded hospitality booking', () => {
  for (const payment of [
    partialPayment,
    { ...partialPayment, kind: 'OFFLINE_PAYMENT' as const, providerCode: 'manual', providerReference: 'receipt_partial' },
  ]) {
    const result = deriveBookingPaymentStatusFromSettlementTransactions({
      bookingTotalMinor: 12_500n, currency: 'AUD', transactions: [payment],
    });
    assert.equal(result.reconciled, false);
    if (!result.reconciled) assert.match(result.reason, /requires successful refund evidence/i);
  }
});

test('a real source-attributed refund permits partially refunded state', () => {
  const result = deriveBookingPaymentStatusFromSettlementTransactions({
    bookingTotalMinor: 12_500n,
    currency: 'AUD',
    transactions: [
      { ...partialPayment, amountMinor: 10_000n },
      { kind: 'REFUND', status: 'SUCCEEDED', providerCode: 'stripe',
        providerReference: 're_partial', sourceProviderReference: 'pi_partial',
        currency: 'AUD', amountMinor: 2_000n },
    ],
  });
  assert.deepEqual(result, { reconciled: true, paymentStatus: 'PARTIALLY_REFUNDED' });
});
