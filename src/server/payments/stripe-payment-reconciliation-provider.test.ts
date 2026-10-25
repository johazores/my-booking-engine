import assert from 'node:assert/strict';
import test from 'node:test';

import { PaymentProviderError } from './payment-provider.ts';
import { StripePaymentReconciliationProvider } from './stripe-payment-reconciliation-provider.ts';

function providerWithResponse(body: Record<string, unknown>) {
  return new StripePaymentReconciliationProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'pi_terminal_evidence', status: 'canceled', amount: 12500,
      currency: 'usd', ...body,
    })),
  });
}

test('Stripe reconciliation rejects missing terminal money instead of inventing zero', async () => {
  for (const status of ['canceled', 'succeeded']) {
    for (const evidence of [
      { amount_received: undefined, amount_capturable: 0 },
      { amount_received: 0, amount_capturable: undefined },
      { amount_received: null, amount_capturable: 0 },
      { amount_received: 0, amount_capturable: null },
    ]) {
      const provider = providerWithResponse({ status, ...evidence });
      await assert.rejects(
        provider.retrievePaymentIntent('pi_terminal_evidence'),
        (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
      );
    }
  }
});

test('Stripe reconciliation preserves complete canceled and settled evidence', async () => {
  const canceled = await providerWithResponse({ amount_received: 0, amount_capturable: 0 })
    .retrievePaymentIntent('pi_terminal_evidence');
  assert.deepEqual(
    { status: canceled.status, amountReceivedMinor: canceled.amountReceivedMinor, amountCapturableMinor: canceled.amountCapturableMinor },
    { status: 'canceled', amountReceivedMinor: 0n, amountCapturableMinor: 0n },
  );
  const settled = await providerWithResponse({
    status: 'succeeded', amount_received: 12500, amount_capturable: 0,
  }).retrievePaymentIntent('pi_terminal_evidence');
  assert.equal(settled.amountReceivedMinor, 12500n);
  assert.equal(settled.amountCapturableMinor, 0n);
});

test('Stripe reconciliation keeps nonterminal pending states and exact provider identity', async () => {
  const pending = await providerWithResponse({ status: 'processing' }).retrievePaymentIntent('pi_terminal_evidence');
  assert.equal(pending.status, 'processing');
  assert.equal(pending.amountReceivedMinor, 0n);
  const mismatched = providerWithResponse({ id: 'pi_other', amount_received: 0, amount_capturable: 0 });
  await assert.rejects(
    mismatched.retrievePaymentIntent('pi_terminal_evidence'),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
  );
});


test('Stripe provider-truth lookup rejects canceled money and settled capturable balances', async () => {
  for (const evidence of [
    { status: 'canceled', amount_received: 1, amount_capturable: 0 },
    { status: 'canceled', amount_received: 0, amount_capturable: 1 },
    { status: 'succeeded', amount_received: 12500, amount_capturable: 1 },
  ]) {
    await assert.rejects(
      providerWithResponse(evidence).retrievePaymentIntent('pi_terminal_evidence'),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
});


test('Stripe failed PaymentIntent lookup does not discard received or capturable money', async () => {
  for (const evidence of [
    { status: 'requires_payment_method', amount_received: undefined, amount_capturable: 0 },
    { status: 'requires_payment_method', amount_received: 0, amount_capturable: undefined },
    { status: 'requires_payment_method', amount_received: 1, amount_capturable: 0 },
    { status: 'requires_payment_method', amount_received: 0, amount_capturable: 1 },
  ]) {
    await assert.rejects(
      providerWithResponse(evidence).retrievePaymentIntent('pi_terminal_evidence'),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
});
