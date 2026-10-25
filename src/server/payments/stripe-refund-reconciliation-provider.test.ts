import assert from 'node:assert/strict';
import test from 'node:test';

import { PaymentProviderError } from './payment-provider.ts';
import { normalizeStripeRefundReference, StripeRefundReconciliationProvider } from './stripe-refund-reconciliation-provider.ts';

test('Stripe refund lookup references fit the persisted ledger reference limit', () => {
  assert.equal(normalizeStripeRefundReference(`re_${'x'.repeat(157)}`).length, 160);
  assert.throws(
    () => normalizeStripeRefundReference(`re_${'x'.repeat(158)}`),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST',
  );
});

test('Stripe refund reconciliation treats malformed provider source identity as retryable unknown truth', async () => {
  const provider = new StripeRefundReconciliationProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 're_valid', payment_intent: `pi_${'x'.repeat(158)}`,
      status: 'succeeded', currency: 'usd', amount: 4100,
    })),
  });
  await assert.rejects(
    provider.retrieveRefund('re_valid'),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
  );
});
