import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://sf_unit_test:sf_unit_test@127.0.0.1:5432/sf_unit_test';

const {
  nextStripeRefundBookingPaymentStatus,
  normalizeStripeRefundAmount,
  selectStripeRefundSource,
  stripeRefundPersistenceStatus,
  stripeRefundRequestFingerprint,
} = await import('./stripe-refund-service.ts');

test('Stripe refund amount parsing is exact and rejects unsafe values', () => {
  assert.equal(normalizeStripeRefundAmount(undefined), null);
  assert.equal(normalizeStripeRefundAmount('4100'), 4100n);
  assert.equal(normalizeStripeRefundAmount(4100n), 4100n);
  assert.throws(() => normalizeStripeRefundAmount('0'), /positive integer/i);
  assert.throws(() => normalizeStripeRefundAmount('-1'), /positive integer/i);
  assert.throws(() => normalizeStripeRefundAmount(4100), /positive integer/i);
});

test('Stripe refund persistence only marks provider-proven refunds as succeeded', () => {
  assert.equal(stripeRefundPersistenceStatus('REFUNDED'), 'SUCCEEDED');
  assert.equal(stripeRefundPersistenceStatus('PENDING'), 'PENDING');
  assert.equal(stripeRefundPersistenceStatus('FAILED'), 'FAILED');
});

test('Stripe refund balance maps partial and full refunds without over-refunding', () => {
  assert.equal(nextStripeRefundBookingPaymentStatus({ sourceAmountMinor: 10000n, refundedBeforeMinor: 0n, refundAmountMinor: 2500n }), 'PARTIALLY_REFUNDED');
  assert.equal(nextStripeRefundBookingPaymentStatus({ sourceAmountMinor: 10000n, refundedBeforeMinor: 2500n, refundAmountMinor: 7500n }), 'REFUNDED');
  assert.throws(
    () => nextStripeRefundBookingPaymentStatus({ sourceAmountMinor: 10000n, refundedBeforeMinor: 2500n, refundAmountMinor: 7501n }),
    /exceeds the remaining refundable balance/i,
  );
});

test('Stripe refund fingerprint distinguishes explicit amount from refund-remaining intent', () => {
  const base = { bookingId: 'booking-1', currency: 'USD', amountMinor: 4100n, sourceProviderReference: 'pi_source_1' } as const;
  const explicit = stripeRefundRequestFingerprint({ ...base, mode: 'explicit' });
  const remaining = stripeRefundRequestFingerprint({ ...base, mode: 'remaining' });
  assert.match(explicit, /^[0-9a-f]{64}$/);
  assert.equal(explicit, stripeRefundRequestFingerprint({ ...base, mode: 'explicit' }));
  assert.notEqual(explicit, remaining);
});

test('Stripe refund source prefers capture and only falls back to a proven settled authorization', () => {
  const authorization = {
    id: 'auth-1',
    bookingId: 'booking-1',
    kind: 'AUTHORIZATION',
    status: 'SUCCEEDED',
    providerCode: 'stripe',
    providerReference: 'pi_1',
    currency: 'USD',
    amountMinor: 10000n,
  } as const;
  const capture = { ...authorization, id: 'capture-1', kind: 'CAPTURE' } as const;

  assert.equal(selectStripeRefundSource([authorization, capture], { allowAuthorizationFallback: true })?.id, 'capture-1');
  assert.equal(selectStripeRefundSource([authorization], { allowAuthorizationFallback: true })?.id, 'auth-1');
  assert.equal(selectStripeRefundSource([authorization], { allowAuthorizationFallback: false }), null);
});

test('Stripe refund source fails closed on ambiguous settled rows and ignores internal claims', () => {
  const capture = {
    id: 'capture-1',
    bookingId: 'booking-1',
    kind: 'CAPTURE',
    status: 'SUCCEEDED',
    providerCode: 'stripe',
    providerReference: 'pi_1',
    currency: 'USD',
    amountMinor: 10000n,
  } as const;
  assert.throws(
    () => selectStripeRefundSource([capture, { ...capture, id: 'capture-2', providerReference: 'pi_2' }], { allowAuthorizationFallback: true }),
    /multiple successful captures/i,
  );
  assert.equal(
    selectStripeRefundSource([{ ...capture, providerReference: 'sf_claim_deadbeef' }], { allowAuthorizationFallback: true }),
    null,
  );
});
