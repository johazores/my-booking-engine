import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertStripeCommercialAmendmentRecoveryRefundReference,
  reconcileStripeCommercialAmendmentRecoveryAuthorization,
  stripeCommercialAmendmentRecoveryClaimReference,
  stripeCommercialAmendmentRecoveryFingerprint,
  stripeCommercialAmendmentRecoveryOperationKey,
} from './booking-commercial-amendment-stripe-recovery-domain.ts';

const bookingId = '11111111-1111-4111-8111-111111111111';
const amendmentId = '22222222-2222-4222-8222-222222222222';

function snapshot(overrides: Partial<{
  providerReference: string;
  status: string;
  currency: string;
  amountMinor: bigint;
  amountReceivedMinor: bigint;
  amountCapturableMinor: bigint;
}> = {}) {
  return {
    providerReference: 'pi_recovery_1',
    status: 'requires_capture',
    currency: 'USD',
    amountMinor: 2500n,
    amountReceivedMinor: 0n,
    amountCapturableMinor: 2500n,
    ...overrides,
  };
}

test('recovery operation keys are deterministic and separated by operation and source', () => {
  const first = stripeCommercialAmendmentRecoveryOperationKey({
    bookingId,
    amendmentId,
    operation: 'CAPTURE_COMPENSATION',
    providerReference: 'pi_recovery_1',
  });
  const repeated = stripeCommercialAmendmentRecoveryOperationKey({
    bookingId,
    amendmentId,
    operation: 'CAPTURE_COMPENSATION',
    providerReference: 'pi_recovery_1',
  });
  const refund = stripeCommercialAmendmentRecoveryOperationKey({
    bookingId,
    amendmentId,
    operation: 'COMPENSATION_REFUND',
    providerReference: 'pi_recovery_1',
  });
  const otherSource = stripeCommercialAmendmentRecoveryOperationKey({
    bookingId,
    amendmentId,
    operation: 'COMPENSATION_REFUND',
    providerReference: 'pi_recovery_2',
  });
  assert.equal(first, repeated);
  assert.notEqual(first, refund);
  assert.notEqual(refund, otherSource);
  assert.match(first, /^ca-stripe-recovery-capture-[0-9a-f]{64}$/);
});

test('recovery fingerprints bind operation, exact money, and provider source', () => {
  const base = stripeCommercialAmendmentRecoveryFingerprint({
    bookingId,
    amendmentId,
    operation: 'COMPENSATION_REFUND',
    currency: 'USD',
    amountMinor: 2500n,
    providerReference: 'pi_recovery_1',
  });
  const changedMoney = stripeCommercialAmendmentRecoveryFingerprint({
    bookingId,
    amendmentId,
    operation: 'COMPENSATION_REFUND',
    currency: 'USD',
    amountMinor: 2499n,
    providerReference: 'pi_recovery_1',
  });
  const changedOperation = stripeCommercialAmendmentRecoveryFingerprint({
    bookingId,
    amendmentId,
    operation: 'CAPTURE_COMPENSATION',
    currency: 'USD',
    amountMinor: 2500n,
    providerReference: 'pi_recovery_1',
  });
  assert.notEqual(base, changedMoney);
  assert.notEqual(base, changedOperation);
  assert.equal(stripeCommercialAmendmentRecoveryClaimReference(base), `sf_claim_${base}`);
});

test('provider truth keeps an exact manual-capture authorization releasable', () => {
  assert.deepEqual(reconcileStripeCommercialAmendmentRecoveryAuthorization({
    providerReference: 'pi_recovery_1',
    currency: 'USD',
    amountMinor: 2500n,
    snapshot: snapshot(),
  }), { state: 'RELEASE_REQUIRED' });
});

test('provider truth recognizes a fully released authorization only with zero settled money', () => {
  assert.deepEqual(reconcileStripeCommercialAmendmentRecoveryAuthorization({
    providerReference: 'pi_recovery_1',
    currency: 'USD',
    amountMinor: 2500n,
    snapshot: snapshot({ status: 'canceled', amountCapturableMinor: 0n }),
  }), { state: 'RELEASED' });

  assert.throws(() => reconcileStripeCommercialAmendmentRecoveryAuthorization({
    providerReference: 'pi_recovery_1',
    currency: 'USD',
    amountMinor: 2500n,
    snapshot: snapshot({ status: 'canceled', amountReceivedMinor: 500n, amountCapturableMinor: 0n }),
  }), /unexplained settled money/);
});

test('provider truth recognizes direct settlement only for the exact authorized amount', () => {
  assert.deepEqual(reconcileStripeCommercialAmendmentRecoveryAuthorization({
    providerReference: 'pi_recovery_1',
    currency: 'USD',
    amountMinor: 2500n,
    snapshot: snapshot({ status: 'succeeded', amountReceivedMinor: 2500n, amountCapturableMinor: 0n }),
  }), { state: 'SETTLED' });

  assert.throws(() => reconcileStripeCommercialAmendmentRecoveryAuthorization({
    providerReference: 'pi_recovery_1',
    currency: 'USD',
    amountMinor: 2500n,
    snapshot: snapshot({ status: 'succeeded', amountReceivedMinor: 2499n, amountCapturableMinor: 0n }),
  }), /does not match/);
});

test('non-final authorization state waits rather than guessing', () => {
  assert.deepEqual(reconcileStripeCommercialAmendmentRecoveryAuthorization({
    providerReference: 'pi_recovery_1',
    currency: 'USD',
    amountMinor: 2500n,
    snapshot: snapshot({ status: 'processing', amountCapturableMinor: 0n }),
  }), { state: 'WAIT_FOR_PROVIDER', providerStatus: 'processing' });
});

test('provider identity, money, and refund reference validation fail closed', () => {
  assert.throws(() => reconcileStripeCommercialAmendmentRecoveryAuthorization({
    providerReference: 'pi_recovery_1',
    currency: 'USD',
    amountMinor: 2500n,
    snapshot: snapshot({ providerReference: 'pi_other' }),
  }), /does not match/);
  assert.throws(() => stripeCommercialAmendmentRecoveryFingerprint({
    bookingId,
    amendmentId,
    operation: 'COMPENSATION_REFUND',
    currency: 'usd',
    amountMinor: 2500n,
    providerReference: 'pi_recovery_1',
  }), /money/);
  assert.equal(assertStripeCommercialAmendmentRecoveryRefundReference('re_recovery_1'), 're_recovery_1');
  assert.throws(() => assertStripeCommercialAmendmentRecoveryRefundReference('pi_wrong'), /refund reference/);
});
