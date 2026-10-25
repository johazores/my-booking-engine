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

test('Stripe refund retrieval rejects unsupported or noncanonical provider currencies', async () => {
  for (const currency of [null, 'zzz', 'USD', ' usd ', 123]) {
    const provider = new StripeRefundReconciliationProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 're_currency_1', payment_intent: 'pi_currency_1', status: 'succeeded', amount: 4100, currency,
      })),
    });
    await assert.rejects(provider.retrieveRefund('re_currency_1'),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable);
  }
});

test('Stripe refund lookup preserves HTTP status when error JSON is malformed', async () => {
  for (const [status, code, retryable] of [[429, 'RATE_LIMITED', true], [401, 'AUTHENTICATION_FAILED', false]] as const) {
    const provider = new StripeRefundReconciliationProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response('null', { status }),
    });
    await assert.rejects(provider.retrieveRefund('re_currency_1'),
      (error: unknown) => error instanceof PaymentProviderError && error.code === code && error.retryable === retryable);
  }
});

test('Stripe refund lookup treats HTTP 408 as retryable timeout rather than invalid request', async () => {
  const provider = new StripeRefundReconciliationProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({ error: { type: 'card_error' } }), { status: 408 }),
  });
  await assert.rejects(provider.retrieveRefund('re_valid'),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'TIMEOUT' && error.retryable);
});
