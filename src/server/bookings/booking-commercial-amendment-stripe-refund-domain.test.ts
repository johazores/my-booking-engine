import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveStripeCommercialAmendmentRefundClaim,
  reconcileStripeCommercialAmendmentRefundSnapshot,
  stripeCommercialAmendmentRefundFingerprint,
  stripeCommercialAmendmentRefundPersistenceStatus,
} from './booking-commercial-amendment-stripe-refund-domain.ts';

const decision = (overrides: Record<string, unknown> = {}) => ({
  state: 'EXECUTE' as const,
  operation: 'REFUND' as const,
  providerCode: 'stripe' as const,
  sourceProviderReference: 'pi_settlement_1',
  sourceKind: 'CAPTURE' as const,
  currency: 'USD',
  amountMinor: 2500n,
  ...overrides,
});

test('derives a deterministic Stripe amendment refund claim from server-selected money and source', () => {
  const first = deriveStripeCommercialAmendmentRefundClaim({
    bookingId: 'booking-1',
    amendmentId: 'amendment-1',
    decision: decision(),
  });
  const second = deriveStripeCommercialAmendmentRefundClaim({
    bookingId: 'booking-1',
    amendmentId: 'amendment-1',
    decision: decision(),
  });
  assert.deepEqual(first, second);
  assert.equal(first.providerCode, 'stripe');
  assert.equal(first.kind, 'REFUND');
  assert.equal(first.sourceProviderReference, 'pi_settlement_1');
  assert.match(first.requestFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(first.claimReference, `sf_claim_${first.requestFingerprint}`);
});

test('persisted refund fingerprints can be revalidated without inventing a settlement kind', () => {
  const fingerprint = stripeCommercialAmendmentRefundFingerprint({
    bookingId: 'booking-1',
    amendmentId: 'amendment-1',
    currency: 'USD',
    amountMinor: 2500n,
    sourceProviderReference: 'pi_settlement_1',
  });
  const claim = deriveStripeCommercialAmendmentRefundClaim({ bookingId: 'booking-1', amendmentId: 'amendment-1', decision: decision() });
  assert.equal(fingerprint, claim.requestFingerprint);
});

test('claim fingerprint changes when amendment, money, or settlement source changes', () => {
  const base = deriveStripeCommercialAmendmentRefundClaim({ bookingId: 'booking-1', amendmentId: 'amendment-1', decision: decision() });
  const variants = [
    deriveStripeCommercialAmendmentRefundClaim({ bookingId: 'booking-1', amendmentId: 'amendment-2', decision: decision() }),
    deriveStripeCommercialAmendmentRefundClaim({ bookingId: 'booking-1', amendmentId: 'amendment-1', decision: decision({ amountMinor: 2499n }) }),
    deriveStripeCommercialAmendmentRefundClaim({ bookingId: 'booking-1', amendmentId: 'amendment-1', decision: decision({ sourceProviderReference: 'pi_settlement_2' }) }),
  ];
  for (const variant of variants) assert.notEqual(variant.requestFingerprint, base.requestFingerprint);
});

test('rejects offline, malformed source, invalid money, and non-Stripe decisions', () => {
  for (const invalid of [
    decision({ sourceKind: 'OFFLINE_PAYMENT' }),
    decision({ sourceProviderReference: 'manual-1' }),
    decision({ amountMinor: 0n }),
    decision({ currency: 'usd' }),
    decision({ providerCode: 'manual' }),
  ]) {
    assert.throws(() => deriveStripeCommercialAmendmentRefundClaim({
      bookingId: 'booking-1',
      amendmentId: 'amendment-1',
      decision: invalid as ReturnType<typeof decision>,
    }));
  }
});

test('maps Stripe refund provider results without exposing amendment operations to generic pending-payment finalizers', () => {
  assert.equal(stripeCommercialAmendmentRefundPersistenceStatus('REFUNDED'), 'SUCCEEDED');
  assert.equal(stripeCommercialAmendmentRefundPersistenceStatus('PENDING'), 'AMBIGUOUS');
  assert.equal(stripeCommercialAmendmentRefundPersistenceStatus('FAILED'), 'FAILED');
});

test('reconciliation accepts exact provider truth and fails closed on source or money drift', () => {
  const base = {
    currency: 'USD',
    amountMinor: 2500n,
    sourceProviderReference: 'pi_settlement_1',
  };
  const snapshot = {
    paymentIntentReference: 'pi_settlement_1',
    status: 'succeeded',
    currency: 'USD',
    amountMinor: 2500n,
  };
  assert.equal(reconcileStripeCommercialAmendmentRefundSnapshot({ ...base, snapshot }), 'SUCCEEDED');
  assert.equal(reconcileStripeCommercialAmendmentRefundSnapshot({ ...base, snapshot: { ...snapshot, status: 'pending' } }), 'AMBIGUOUS');
  assert.equal(reconcileStripeCommercialAmendmentRefundSnapshot({ ...base, snapshot: { ...snapshot, status: 'failed' } }), 'FAILED');
  assert.throws(() => reconcileStripeCommercialAmendmentRefundSnapshot({ ...base, snapshot: { ...snapshot, amountMinor: 2499n } }));
  assert.throws(() => reconcileStripeCommercialAmendmentRefundSnapshot({ ...base, snapshot: { ...snapshot, paymentIntentReference: 'pi_other' } }));
});
