import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentProviderError } from './payment-provider.ts';
import { normalizeStripeRefundReference, StripeRefundReconciliationProvider } from './stripe-refund-reconciliation-provider.ts';

const STRIPE_OWNER = Object.freeze({ organizationId: '11111111-1111-4111-8111-111111111111', bookingId: '22222222-2222-4222-8222-222222222222' });

test('Stripe refund lookup references fit the persisted ledger reference limit', () => {
  assert.equal(normalizeStripeRefundReference(`re_${'x'.repeat(157)}`).length, 160);
  assert.throws(
    () => normalizeStripeRefundReference(`re_${'x'.repeat(158)}`),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST',
  );
});

test('Stripe refund reconciliation rejects padded persisted references before network I/O', async () => {
  let calls = 0;
  const provider = new StripeRefundReconciliationProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => { calls += 1; throw new Error('Unexpected network I/O.'); },
  });
  for (const reference of [' re_owned', 're_owned ', '\tre_owned', 're_owned\n']) {
    assert.throws(() => normalizeStripeRefundReference(reference),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST');
    await assert.rejects(provider.retrieveRefund(reference, STRIPE_OWNER),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'INVALID_REQUEST');
  }
  assert.equal(calls, 0);
});

test('Stripe refund reconciliation treats malformed provider source identity as retryable unknown truth', async () => {
  const provider = new StripeRefundReconciliationProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      metadata: { sf_organization_id: STRIPE_OWNER.organizationId, sf_booking_id: STRIPE_OWNER.bookingId },
      id: 're_valid', payment_intent: `pi_${'x'.repeat(158)}`,
      status: 'succeeded', currency: 'usd', amount: 4100,
    })),
  });
  await assert.rejects(
    provider.retrieveRefund('re_valid', STRIPE_OWNER),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable,
  );
});

test('Stripe refund retrieval rejects unsupported or noncanonical provider currencies', async () => {
  for (const currency of [null, 'zzz', 'USD', ' usd ', 123]) {
    const provider = new StripeRefundReconciliationProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        metadata: { sf_organization_id: STRIPE_OWNER.organizationId, sf_booking_id: STRIPE_OWNER.bookingId },
        id: 're_currency_1', payment_intent: 'pi_currency_1', status: 'succeeded', amount: 4100, currency,
      })),
    });
    await assert.rejects(provider.retrieveRefund('re_currency_1', STRIPE_OWNER),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable);
  }
});

test('Stripe refund lookup preserves HTTP status when error JSON is malformed', async () => {
  for (const [status, code, retryable] of [
    [429, 'RATE_LIMITED', true],
    [409, 'UNKNOWN', true],
    [424, 'PROVIDER_UNAVAILABLE', true],
    [402, 'UNKNOWN', true],
    [401, 'AUTHENTICATION_FAILED', false],
  ] as const) {
    const provider = new StripeRefundReconciliationProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response('null', { status }),
    });
    await assert.rejects(provider.retrieveRefund('re_currency_1', STRIPE_OWNER),
      (error: unknown) => error instanceof PaymentProviderError && error.code === code && error.retryable === retryable);
  }
});

test('Stripe refund lookup treats HTTP 408 as retryable timeout rather than invalid request', async () => {
  const provider = new StripeRefundReconciliationProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({ error: { type: 'card_error' } }), { status: 408 }),
  });
  await assert.rejects(provider.retrieveRefund('re_valid', STRIPE_OWNER),
    (error: unknown) => error instanceof PaymentProviderError && error.code === 'TIMEOUT' && error.retryable);
});

test('Stripe refund lookup preserves provider api_error ambiguity across atypical 4xx', async () => {
  for (const item of [
    { status: 400, type: 'api_error', code: 'UNKNOWN', retryable: true },
    { status: 422, type: 'api_error', code: 'UNKNOWN', retryable: true },
    { status: 404, type: 'api_error', code: 'INVALID_REQUEST', retryable: false },
    { status: 400, type: 'card_error', code: 'INVALID_REQUEST', retryable: false },
  ] as const) {
    const provider = new StripeRefundReconciliationProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({ error: { type: item.type } }), { status: item.status }),
    });
    await assert.rejects(provider.retrieveRefund('re_currency_1', STRIPE_OWNER),
      (error: unknown) => error instanceof PaymentProviderError && error.code === item.code && error.retryable === item.retryable);
  }
});

test('Stripe Refund reconciliation requires exact tenant and booking metadata', async () => {
  const correct = { sf_organization_id: STRIPE_OWNER.organizationId, sf_booking_id: STRIPE_OWNER.bookingId };
  for (const metadata of [
    undefined, null, {}, [], 'invalid',
    { ...correct, sf_organization_id: '33333333-3333-4333-8333-333333333333' },
    { ...correct, sf_booking_id: '44444444-4444-4444-8444-444444444444' },
    { ...correct, sf_organization_id: `${STRIPE_OWNER.organizationId} ` },
    { ...correct, sf_booking_id: ` ${STRIPE_OWNER.bookingId}` },
  ]) {
    const provider = new StripeRefundReconciliationProvider({
      secretKey: 'sk_test_not-a-real-secret',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 're_owned', payment_intent: 'pi_owned', status: 'succeeded', currency: 'usd', amount: 4100, metadata,
      })),
    });
    await assert.rejects(provider.retrieveRefund('re_owned', STRIPE_OWNER),
      (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable);
  }
  const provider = new StripeRefundReconciliationProvider({
    secretKey: 'sk_test_not-a-real-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 're_owned', payment_intent: 'pi_owned', status: 'succeeded', currency: 'usd', amount: 4100, metadata: correct,
    })),
  });
  const snapshot = await provider.retrieveRefund('re_owned', STRIPE_OWNER);
  assert.equal(snapshot.refundReference, 're_owned');
  assert.equal(snapshot.amountMinor, 4100n);
});
