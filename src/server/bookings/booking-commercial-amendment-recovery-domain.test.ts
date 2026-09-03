import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveHospitalityCommercialAmendmentRecoveryDecision,
  type HospitalityCommercialAmendmentRecoveryInput,
  type HospitalityCommercialAmendmentRecoveryTransaction,
} from './booking-commercial-amendment-recovery-domain.ts';

const amendmentId = 'amendment-1';
const createdAt = new Date('2026-09-03T01:00:00.000Z');
const expiresAt = new Date('2026-09-03T01:15:00.000Z');
const now = new Date('2026-09-03T01:20:00.000Z');
const baselineCreatedAt = new Date('2026-09-03T00:30:00.000Z');
const adjustmentCreatedAt = new Date('2026-09-03T01:05:00.000Z');

function transaction(
  overrides: Partial<HospitalityCommercialAmendmentRecoveryTransaction> = {},
): HospitalityCommercialAmendmentRecoveryTransaction {
  return {
    commercialAmendmentId: null,
    kind: 'OFFLINE_PAYMENT',
    status: 'SUCCEEDED',
    providerCode: 'manual',
    providerReference: 'base-payment',
    sourceProviderReference: null,
    currency: 'USD',
    amountMinor: 1000n,
    createdAt: baselineCreatedAt,
    ...overrides,
  };
}

function additionalChargeInput(
  transactions: readonly HospitalityCommercialAmendmentRecoveryTransaction[],
  overrides: Partial<HospitalityCommercialAmendmentRecoveryInput> = {},
): HospitalityCommercialAmendmentRecoveryInput {
  return {
    amendmentId,
    status: 'PREPARED',
    direction: 'ADDITIONAL_CHARGE',
    paymentProviderCode: 'manual',
    currency: 'USD',
    beforeTotalMinor: 1000n,
    afterTotalMinor: 1200n,
    deltaMinor: 200n,
    createdAt,
    expiresAt,
    now,
    transactions,
    ...overrides,
  };
}

function refundInput(
  transactions: readonly HospitalityCommercialAmendmentRecoveryTransaction[],
  overrides: Partial<HospitalityCommercialAmendmentRecoveryInput> = {},
): HospitalityCommercialAmendmentRecoveryInput {
  return {
    amendmentId,
    status: 'PREPARED',
    direction: 'REFUND',
    paymentProviderCode: 'manual',
    currency: 'USD',
    beforeTotalMinor: 1000n,
    afterTotalMinor: 800n,
    deltaMinor: -200n,
    createdAt,
    expiresAt,
    now,
    transactions,
    ...overrides,
  };
}

const baseline = transaction();

test('expired amendment with no settled adjustment money is ready to expire', () => {
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(additionalChargeInput([baseline]));
  assert.deepEqual(decision, {
    state: 'READY_TO_EXPIRE',
    netSettledMinor: 1000n,
    reason: 'Authoritative booking settlement has been restored to the pre-amendment total.',
  });
});

test('unresolved amendment payment evidence waits for provider truth', () => {
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(additionalChargeInput([
    baseline,
    transaction({
      commercialAmendmentId: amendmentId,
      kind: 'CAPTURE',
      status: 'AMBIGUOUS',
      providerCode: 'manual',
      providerReference: 'adjustment-claim',
      amountMinor: 200n,
      createdAt: adjustmentCreatedAt,
    }),
  ]));
  assert.equal(decision.state, 'WAIT_FOR_PROVIDER');
});

test('settled additional charge compensates only from an amendment-created source', () => {
  const adjustment = transaction({
    commercialAmendmentId: amendmentId,
    providerReference: 'adjustment-payment',
    amountMinor: 200n,
    createdAt: adjustmentCreatedAt,
  });
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(additionalChargeInput([baseline, adjustment]));
  assert.deepEqual(decision, {
    state: 'COMPENSATE',
    operation: 'REFUND',
    providerCode: 'manual',
    sourceProviderReference: 'adjustment-payment',
    sourceKind: 'OFFLINE_PAYMENT',
    currency: 'USD',
    amountMinor: 200n,
    sourceRefundableMinor: 200n,
    remainingRecoveryMinor: 200n,
    reason: 'Expired commercial amendment settled more than the original booking total and must refund the adjustment-created settlement source.',
  });
});

test('successful refund compensation restores the original total and closes recovery', () => {
  const adjustment = transaction({
    commercialAmendmentId: amendmentId,
    providerReference: 'adjustment-payment',
    amountMinor: 200n,
    createdAt: adjustmentCreatedAt,
  });
  const compensation = transaction({
    commercialAmendmentId: amendmentId,
    kind: 'REFUND',
    providerReference: 'compensation-refund',
    sourceProviderReference: 'adjustment-payment',
    amountMinor: 200n,
    createdAt: new Date('2026-09-03T01:21:00.000Z'),
  });
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(additionalChargeInput([baseline, adjustment, compensation]));
  assert.equal(decision.state, 'READY_TO_EXPIRE');
});

test('partial additional-charge settlement compensates only the settled excess', () => {
  const adjustment = transaction({
    commercialAmendmentId: amendmentId,
    providerReference: 'adjustment-payment',
    amountMinor: 80n,
    createdAt: adjustmentCreatedAt,
  });
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(additionalChargeInput([baseline, adjustment]));
  assert.equal(decision.state, 'COMPENSATE');
  if (decision.state === 'COMPENSATE') {
    assert.equal(decision.operation, 'REFUND');
    assert.equal(decision.amountMinor, 80n);
  }
});

test('settled refund amendment requires a compensation charge back to the original total', () => {
  const adjustmentRefund = transaction({
    commercialAmendmentId: amendmentId,
    kind: 'REFUND',
    providerReference: 'adjustment-refund',
    sourceProviderReference: 'base-payment',
    amountMinor: 200n,
    createdAt: adjustmentCreatedAt,
  });
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(refundInput([baseline, adjustmentRefund]));
  assert.deepEqual(decision, {
    state: 'COMPENSATE',
    operation: 'ADDITIONAL_CHARGE',
    providerCode: 'manual',
    currency: 'USD',
    amountMinor: 200n,
    reason: 'Expired commercial amendment settled below the original booking total and requires a compensation charge before it can be closed.',
  });
});

test('manual compensation charge after refund restores the original total', () => {
  const adjustmentRefund = transaction({
    commercialAmendmentId: amendmentId,
    kind: 'REFUND',
    providerReference: 'adjustment-refund',
    sourceProviderReference: 'base-payment',
    amountMinor: 125n,
    createdAt: adjustmentCreatedAt,
  });
  const compensationCharge = transaction({
    commercialAmendmentId: amendmentId,
    kind: 'OFFLINE_PAYMENT',
    providerReference: 'compensation-charge',
    amountMinor: 125n,
    createdAt: new Date('2026-09-03T01:21:00.000Z'),
  });
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(refundInput([baseline, adjustmentRefund, compensationCharge]));
  assert.equal(decision.state, 'READY_TO_EXPIRE');
});

test('expired Stripe additional-charge authorization must be released, not captured', () => {
  const stripeBaseline = transaction({ providerCode: 'stripe', providerReference: 'pi_base' });
  const authorization = transaction({
    commercialAmendmentId: amendmentId,
    kind: 'AUTHORIZATION',
    providerCode: 'stripe',
    providerReference: 'pi_adjustment',
    amountMinor: 200n,
    createdAt: adjustmentCreatedAt,
  });
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(additionalChargeInput(
    [stripeBaseline, authorization],
    { paymentProviderCode: 'stripe' },
  ));
  assert.equal(decision.state, 'RELEASE_AUTHORIZATION');
  if (decision.state === 'RELEASE_AUTHORIZATION') assert.equal(decision.providerReference, 'pi_adjustment');
});

test('refund recovery treats a standalone Stripe authorization as compensation requiring capture', () => {
  const stripeBaseline = transaction({ providerCode: 'stripe', providerReference: 'pi_base' });
  const adjustmentRefund = transaction({
    commercialAmendmentId: amendmentId,
    kind: 'REFUND',
    providerCode: 'stripe',
    providerReference: 're_adjustment',
    sourceProviderReference: 'pi_base',
    amountMinor: 200n,
    createdAt: adjustmentCreatedAt,
  });
  const compensationAuthorization = transaction({
    commercialAmendmentId: amendmentId,
    kind: 'AUTHORIZATION',
    providerCode: 'stripe',
    providerReference: 'pi_compensation',
    amountMinor: 200n,
    createdAt: new Date('2026-09-03T01:21:00.000Z'),
  });
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(refundInput(
    [stripeBaseline, adjustmentRefund, compensationAuthorization],
    { paymentProviderCode: 'stripe' },
  ));
  assert.equal(decision.state, 'CAPTURE_COMPENSATION');
});

test('post-prepare successful money outside the amendment fails closed', () => {
  const unrelated = transaction({
    providerReference: 'unrelated-payment',
    amountMinor: 25n,
    createdAt: adjustmentCreatedAt,
  });
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(additionalChargeInput([baseline, unrelated]));
  assert.equal(decision.state, 'CONFLICT');
});

test('money outside the prepared before/after boundary fails closed', () => {
  const adjustment = transaction({
    commercialAmendmentId: amendmentId,
    providerReference: 'too-large-adjustment',
    amountMinor: 250n,
    createdAt: adjustmentCreatedAt,
  });
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(additionalChargeInput([baseline, adjustment]));
  assert.equal(decision.state, 'CONFLICT');
});

test('unexpired and terminal amendments never start recovery compensation', () => {
  const unexpired = deriveHospitalityCommercialAmendmentRecoveryDecision(additionalChargeInput(
    [baseline],
    { now: new Date('2026-09-03T01:10:00.000Z') },
  ));
  assert.equal(unexpired.state, 'NOT_EXPIRED');

  const terminal = deriveHospitalityCommercialAmendmentRecoveryDecision(additionalChargeInput(
    [baseline],
    { status: 'APPLIED' },
  ));
  assert.equal(terminal.state, 'TERMINAL');
});

test('refund recovery rejects an authorization that exceeds the exact compensation gap', () => {
  const stripeBaseline = transaction({ providerCode: 'stripe', providerReference: 'pi_base' });
  const adjustmentRefund = transaction({
    commercialAmendmentId: amendmentId,
    kind: 'REFUND',
    providerCode: 'stripe',
    providerReference: 're_adjustment',
    sourceProviderReference: 'pi_base',
    amountMinor: 100n,
    createdAt: adjustmentCreatedAt,
  });
  const oversizedAuthorization = transaction({
    commercialAmendmentId: amendmentId,
    kind: 'AUTHORIZATION',
    providerCode: 'stripe',
    providerReference: 'pi_compensation',
    amountMinor: 200n,
    createdAt: new Date('2026-09-03T01:21:00.000Z'),
  });
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(refundInput(
    [stripeBaseline, adjustmentRefund, oversizedAuthorization],
    { paymentProviderCode: 'stripe' },
  ));
  assert.equal(decision.state, 'CONFLICT');
});

test('refund recovery releases an unnecessary compensation authorization after net settlement is restored', () => {
  const stripeBaseline = transaction({ providerCode: 'stripe', providerReference: 'pi_base' });
  const authorization = transaction({
    commercialAmendmentId: amendmentId,
    kind: 'AUTHORIZATION',
    providerCode: 'stripe',
    providerReference: 'pi_unused_compensation',
    amountMinor: 200n,
    createdAt: new Date('2026-09-03T01:21:00.000Z'),
  });
  const decision = deriveHospitalityCommercialAmendmentRecoveryDecision(refundInput(
    [stripeBaseline, authorization],
    { paymentProviderCode: 'stripe' },
  ));
  assert.equal(decision.state, 'RELEASE_AUTHORIZATION');
});
