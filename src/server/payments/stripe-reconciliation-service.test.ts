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

test('authorization reconciliation rejects missing, partial, or inconsistent capturable evidence', async () => {
  const base = { providerReference: 'pi_auth', status: 'requires_capture', currency: 'USD', amountMinor: 5000n, amountReceivedMinor: 0n, amountCapturableMinor: 5000n };
  for (const evidence of [
    { amountCapturableMinor: 0n },
    { amountCapturableMinor: 4999n },
    { amountCapturableMinor: 5001n },
    { amountReceivedMinor: 1n },
  ]) {
    assert.throws(
      () => reconcileStripeTransactionState({ kind: 'AUTHORIZATION', currency: 'USD', amountMinor: 5000n, snapshot: { ...base, ...evidence } }),
      /full authorization remains capturable/,
    );
  }
  const provider = new StripePaymentReconciliationProvider({
    secretKey: 'sk_test_reconciliation',
    fetchImpl: async () => stripeResponse({ id: 'pi_auth', status: 'requires_capture', amount: 5000, currency: 'usd', amount_capturable: 5000 }),
  });
  await assert.rejects(
    provider.retrievePaymentIntent('pi_auth'),
    (error: unknown) => (error as { code?: string; retryable?: boolean }).code === 'UNKNOWN' && (error as { retryable?: boolean }).retryable === true,
  );
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


test('Stripe PaymentIntent reconciliation rejects substituted identity and impossible money evidence', async () => {
  for (const body of [
    { id: 'pi_other', status: 'succeeded', amount: 12500, amount_received: 12500, currency: 'usd' },
    { id: 'pi_reconcile_1', status: 'succeeded', amount: 12500, amount_received: -1, currency: 'usd' },
    { id: 'pi_reconcile_1', status: 'requires_capture', amount: 12500, amount_capturable: -1, currency: 'usd' },
    { id: 'pi_reconcile_1', status: 'succeeded', amount: 12500, amount_received: 12501, currency: 'usd' },
  ]) {
    const provider = new StripePaymentReconciliationProvider({
      secretKey: 'sk_test_reconciliation',
      fetchImpl: async () => stripeResponse(body),
    });
    await assert.rejects(
      provider.retrievePaymentIntent('pi_reconcile_1'),
      (error: unknown) => (error as { code?: string; retryable?: boolean }).code === 'UNKNOWN' && (error as { retryable?: boolean }).retryable === true,
    );
  }
});


test('reconciliation domain fails closed on contradictory terminal money for authorization and capture', () => {
  const base = { providerReference: 'pi_terminal', currency: 'USD', amountMinor: 5000n };
  for (const kind of ['AUTHORIZATION', 'CAPTURE'] as const) {
    for (const snapshot of [
      { ...base, status: 'canceled', amountReceivedMinor: 1n, amountCapturableMinor: 0n },
      { ...base, status: 'canceled', amountReceivedMinor: 0n, amountCapturableMinor: 1n },
      { ...base, status: 'succeeded', amountReceivedMinor: 5000n, amountCapturableMinor: 1n },
    ]) {
      assert.throws(
        () => reconcileStripeTransactionState({ kind, currency: 'USD', amountMinor: 5000n, snapshot }),
        /still reports (received or capturable|capturable) money/,
      );
    }
  }
});


test('reconciliation domain rejects failed PaymentIntents that still hold money', () => {
  for (const kind of ['AUTHORIZATION', 'CAPTURE'] as const) {
    for (const evidence of [
      { amountReceivedMinor: 1n, amountCapturableMinor: 0n },
      { amountReceivedMinor: 0n, amountCapturableMinor: 1n },
    ]) {
      assert.throws(() => reconcileStripeTransactionState({
        kind, currency: 'USD', amountMinor: 5000n,
        snapshot: { providerReference: 'pi_failed', status: 'requires_payment_method', currency: 'USD', amountMinor: 5000n, ...evidence },
      }), /failed payment still reports received or capturable money/);
    }
  }
});

test('payment reconciliation rejects substituted unknown provider statuses', () => {
  for (const kind of ['AUTHORIZATION', 'CAPTURE'] as const) {
    for (const status of ['unknown', 'paid', 'SUCCEEDED', '']) {
      assert.throws(() => reconcileStripeTransactionState({
        kind, currency: 'USD', amountMinor: 5000n,
        snapshot: { providerReference: 'pi_unknown', status, currency: 'USD',
          amountMinor: 5000n, amountReceivedMinor: 0n, amountCapturableMinor: 0n },
      }), /status is not recognized/);
    }
  }
});
