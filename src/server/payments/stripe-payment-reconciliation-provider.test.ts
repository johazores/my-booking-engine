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
  const pending = await providerWithResponse({ status: 'processing', amount_received: 0, amount_capturable: 0 }).retrievePaymentIntent('pi_terminal_evidence');
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

test('PaymentIntent retrieval rejects unknown statuses instead of returning pending evidence', async () => {
  for (const status of [undefined, null, 'unknown', 'paid', 'SUCCEEDED', 123]) {
    await assert.rejects(
      providerWithResponse({ status, amount_received: 0, amount_capturable: 0 }).retrievePaymentIntent('pi_terminal_evidence'),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
    );
  }
});

test('nonterminal Stripe lookups require explicit and consistent money', async () => {
  for (const status of ['requires_confirmation', 'requires_action', 'processing']) {
    for (const evidence of [
      { amount_received: undefined, amount_capturable: 0 },
      { amount_received: 0, amount_capturable: undefined },
      { amount_received: null, amount_capturable: 0 },
      { amount_received: 0, amount_capturable: null },
    ]) {
      await assert.rejects(
        providerWithResponse({ status, ...evidence }).retrievePaymentIntent('pi_terminal_evidence'),
        (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
      );
    }
  }
  await assert.rejects(
    providerWithResponse({ status: 'processing', amount_received: 7000, amount_capturable: 7000 })
      .retrievePaymentIntent('pi_terminal_evidence'),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
  );
  const pending = await providerWithResponse({ status: 'requires_action', amount_received: 0, amount_capturable: 0 })
    .retrievePaymentIntent('pi_terminal_evidence');
  assert.equal(pending.status, 'requires_action');
  assert.equal(pending.amountReceivedMinor, 0n);
  assert.equal(pending.amountCapturableMinor, 0n);
});

test('Stripe PaymentIntent lookups reject references beyond the ledger column limit before provider I/O', async () => {
  await assert.rejects(
    providerWithResponse({ amount_received: 0, amount_capturable: 0 })
      .retrievePaymentIntent(`pi_${'x'.repeat(158)}`),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST',
  );
});

test('Stripe PaymentIntent retrieval rejects unsupported or noncanonical provider currencies', async () => {
  for (const currency of [null, 'zzz', 'USD', ' usd ', 123]) {
    await assert.rejects(providerWithResponse({ amount_received: 0, amount_capturable: 0, currency })
      .retrievePaymentIntent('pi_terminal_evidence'),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable);
  }
});

test('Stripe PaymentIntent lookup preserves HTTP status when error JSON is malformed', async () => {
  for (const [status, code, retryable] of [
    [429, 'RATE_LIMITED', true],
    [409, 'UNKNOWN', true],
    [424, 'PROVIDER_UNAVAILABLE', true],
    [402, 'UNKNOWN', true],
    [401, 'AUTHENTICATION_FAILED', false],
  ] as const) {
    const provider = new StripePaymentReconciliationProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response('null', { status }),
    });
    await assert.rejects(provider.retrievePaymentIntent('pi_terminal_evidence'),
      (error: unknown) => error instanceof PaymentProviderError && error.code === code && error.retryable === retryable);
  }
});

test('Stripe PaymentIntent lookup treats HTTP 408 as retryable timeout rather than invalid request', async () => {
  const provider = new StripePaymentReconciliationProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({ error: { type: 'card_error' } }), { status: 408 }),
  });
  await assert.rejects(provider.retrievePaymentIntent('pi_terminal_evidence'),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'TIMEOUT' && error.retryable);
});

test('Stripe PaymentIntent lookup preserves provider api_error ambiguity across atypical 4xx', async () => {
  for (const item of [
    { status: 400, type: 'api_error', code: 'UNKNOWN', retryable: true },
    { status: 422, type: 'api_error', code: 'UNKNOWN', retryable: true },
    { status: 404, type: 'api_error', code: 'INVALID_REQUEST', retryable: false },
    { status: 400, type: 'card_error', code: 'INVALID_REQUEST', retryable: false },
  ] as const) {
    const provider = new StripePaymentReconciliationProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({ error: { type: item.type } }), { status: item.status }),
    });
    await assert.rejects(provider.retrievePaymentIntent('pi_terminal_evidence'),
      (error: unknown) => error instanceof PaymentProviderError && error.code === item.code && error.retryable === item.retryable);
  }
});
