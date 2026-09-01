import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://sf_unit_test:sf_unit_test@127.0.0.1:5432/sf_unit_test';

const { StripePaymentReconciliationProvider } = await import('./stripe-payment-reconciliation-provider.ts');
const { reconcileStripeTransactionState, reconciledBookingPaymentStatus } = await import('./stripe-reconciliation-service.ts');

function stripeResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('Stripe reconciliation retrieves a PaymentIntent with authenticated GET and exact money', async () => {
  let request: Request | undefined;
  const provider = new StripePaymentReconciliationProvider({
    secretKey: 'sk_test_reconciliation',
    fetchImpl: async (input, init) => {
      request = new Request(input, init);
      return stripeResponse({ id: 'pi_reconcile_1', status: 'requires_capture', amount: 12500, amount_received: 0, amount_capturable: 12500, currency: 'usd' });
    },
  });

  const snapshot = await provider.retrievePaymentIntent('pi_reconcile_1');
  assert.equal(request?.method, 'GET');
  assert.equal(request?.headers.get('authorization'), 'Bearer sk_test_reconciliation');
  assert.equal(snapshot.providerReference, 'pi_reconcile_1');
  assert.equal(snapshot.currency, 'USD');
  assert.equal(snapshot.amountMinor, 12500n);
  assert.equal(snapshot.amountCapturableMinor, 12500n);
});

test('authorization reconciliation maps requires_capture and succeeded states safely', () => {
  const base = { providerReference: 'pi_auth', currency: 'USD', amountMinor: 5000n, amountReceivedMinor: 0n, amountCapturableMinor: 5000n };
  assert.deepEqual(reconcileStripeTransactionState({ kind: 'AUTHORIZATION', currency: 'USD', amountMinor: 5000n, snapshot: { ...base, status: 'requires_capture' } }), {
    transactionStatus: 'SUCCEEDED',
    bookingPaymentStatus: 'AUTHORIZED',
  });
  assert.deepEqual(reconcileStripeTransactionState({ kind: 'AUTHORIZATION', currency: 'USD', amountMinor: 5000n, snapshot: { ...base, status: 'succeeded', amountReceivedMinor: 5000n, amountCapturableMinor: 0n } }), {
    transactionStatus: 'SUCCEEDED',
    bookingPaymentStatus: 'PAID',
  });
});

test('capture reconciliation keeps unresolved states pending and rejects money mismatches', () => {
  const pending = { providerReference: 'pi_capture', status: 'processing', currency: 'USD', amountMinor: 7000n, amountReceivedMinor: 0n, amountCapturableMinor: 0n };
  assert.deepEqual(reconcileStripeTransactionState({ kind: 'CAPTURE', currency: 'USD', amountMinor: 7000n, snapshot: pending }), {
    transactionStatus: 'PENDING',
    bookingPaymentStatus: 'AUTHORIZED',
  });
  assert.throws(() => reconcileStripeTransactionState({ kind: 'CAPTURE', currency: 'USD', amountMinor: 7001n, snapshot: pending }), /does not match/i);
});

test('reconciliation never regresses a booking that is already paid or refunded', () => {
  assert.equal(reconciledBookingPaymentStatus({ kind: 'CAPTURE', currentStatus: 'PAID', reconciledStatus: 'AUTHORIZED' }), 'PAID');
  assert.equal(reconciledBookingPaymentStatus({ kind: 'AUTHORIZATION', currentStatus: 'PARTIALLY_REFUNDED', reconciledStatus: 'FAILED' }), 'PARTIALLY_REFUNDED');
  assert.equal(reconciledBookingPaymentStatus({ kind: 'AUTHORIZATION', currentStatus: 'REFUNDED', reconciledStatus: 'AUTHORIZED' }), 'REFUNDED');
  assert.equal(reconciledBookingPaymentStatus({ kind: 'AUTHORIZATION', currentStatus: 'AUTHORIZED', reconciledStatus: 'FAILED' }), 'AUTHORIZED');
  assert.throws(() => reconciledBookingPaymentStatus({ kind: 'CAPTURE', currentStatus: 'UNPAID', reconciledStatus: 'AUTHORIZED' }), /cannot be reconciled/i);
});

test('Stripe reconciliation classifies provider lookup failures without treating them as success', async () => {
  const provider = new StripePaymentReconciliationProvider({
    secretKey: 'sk_test_reconciliation',
    fetchImpl: async () => stripeResponse({ error: { message: 'too many requests' } }, 429),
  });
  await assert.rejects(provider.retrievePaymentIntent('pi_reconcile_2'), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'RATE_LIMITED');
    assert.equal((error as { retryable?: boolean }).retryable, true);
    return true;
  });
});
