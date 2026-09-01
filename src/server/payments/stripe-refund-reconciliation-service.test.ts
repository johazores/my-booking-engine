import assert from 'node:assert/strict';
import test from 'node:test';

const { PaymentConflictError } = await import('./payment-service.ts');
const { StripeRefundReconciliationProvider } = await import('./stripe-refund-reconciliation-provider.ts');
const { reconcileStripeRefundState } = await import('./stripe-refund-reconciliation-service.ts');

const snapshot = (overrides: Partial<{
  refundReference: string;
  paymentIntentReference: string;
  status: string;
  currency: string;
  amountMinor: bigint;
}> = {}) => ({
  refundReference: 're_refund_1',
  paymentIntentReference: 'pi_capture_1',
  status: 'succeeded',
  currency: 'USD',
  amountMinor: 2500n,
  ...overrides,
});

test('refund reconciliation provider retrieves Stripe refund truth without replaying a write', async () => {
  let request: Request | undefined;
  const provider = new StripeRefundReconciliationProvider({
    secretKey: 'sk_test_reconciliation',
    fetchImpl: async (input, init) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({
        id: 're_refund_1',
        payment_intent: 'pi_capture_1',
        status: 'succeeded',
        currency: 'usd',
        amount: 2500,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const result = await provider.retrieveRefund('re_refund_1');
  assert.equal(request?.method, 'GET');
  assert.equal(new URL(request!.url).pathname, '/v1/refunds/re_refund_1');
  assert.equal(request?.headers.get('Idempotency-Key'), null);
  assert.deepEqual(result, snapshot());
});

test('refund reconciliation maps only provider-proven terminal states to final ledger states', () => {
  const input = { currency: 'USD', amountMinor: 2500n, sourceProviderReference: 'pi_capture_1' };
  assert.equal(reconcileStripeRefundState({ ...input, snapshot: snapshot({ status: 'succeeded' }) }), 'SUCCEEDED');
  assert.equal(reconcileStripeRefundState({ ...input, snapshot: snapshot({ status: 'failed' }) }), 'FAILED');
  assert.equal(reconcileStripeRefundState({ ...input, snapshot: snapshot({ status: 'canceled' }) }), 'FAILED');
  assert.equal(reconcileStripeRefundState({ ...input, snapshot: snapshot({ status: 'pending' }) }), 'PENDING');
});

test('refund reconciliation rejects Stripe money or source-reference mismatches', () => {
  const input = { currency: 'USD', amountMinor: 2500n, sourceProviderReference: 'pi_capture_1' };
  for (const invalid of [
    snapshot({ currency: 'EUR' }),
    snapshot({ amountMinor: 2400n }),
    snapshot({ paymentIntentReference: 'pi_other' }),
  ]) {
    assert.throws(
      () => reconcileStripeRefundState({ ...input, snapshot: invalid }),
      PaymentConflictError,
    );
  }
});

test('refund reconciliation provider fails closed on invalid Stripe refund payloads', async () => {
  const provider = new StripeRefundReconciliationProvider({
    secretKey: 'sk_test_reconciliation',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 're_refund_1',
      payment_intent: null,
      status: 'succeeded',
      currency: 'usd',
      amount: 2500,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  await assert.rejects(() => provider.retrieveRefund('re_refund_1'));
});
