import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveHospitalityCommercialAmendmentSettlementState,
  type HospitalityCommercialAmendmentSettlementTransaction,
} from './booking-commercial-amendment-settlement-domain.ts';

const amendmentId = '11111111-1111-4111-8111-111111111111';

function transaction(
  overrides: Partial<HospitalityCommercialAmendmentSettlementTransaction> = {},
): HospitalityCommercialAmendmentSettlementTransaction {
  return {
    kind: 'OFFLINE_PAYMENT',
    status: 'SUCCEEDED',
    providerCode: 'manual',
    providerReference: 'receipt-base',
    currency: 'AUD',
    amountMinor: 10_000n,
    ...overrides,
  };
}

function additionalInput(
  transactions: readonly HospitalityCommercialAmendmentSettlementTransaction[],
) {
  return {
    amendmentId,
    direction: 'ADDITIONAL_CHARGE' as const,
    paymentProviderCode: 'manual',
    currency: 'AUD',
    beforeTotalMinor: 10_000n,
    afterTotalMinor: 12_500n,
    deltaMinor: 2_500n,
    transactions,
  };
}

function refundInput(
  transactions: readonly HospitalityCommercialAmendmentSettlementTransaction[],
) {
  return {
    amendmentId,
    direction: 'REFUND' as const,
    paymentProviderCode: 'manual',
    currency: 'AUD',
    beforeTotalMinor: 10_000n,
    afterTotalMinor: 7_500n,
    deltaMinor: -2_500n,
    transactions,
  };
}

test('additional charge requires execution while authoritative net settlement is unchanged', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState(
    additionalInput([transaction()]),
  );
  assert.deepEqual(result, {
    state: 'REQUIRES_EXECUTION',
    readyToApply: false,
    netSettledMinor: 10_000n,
    settledAdjustmentMinor: 0n,
    remainingAdjustmentMinor: 2_500n,
    failedAttemptCount: 0,
  });
});

test('additional charge becomes ready only when the linked settled delta reaches the after total', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState(additionalInput([
    transaction(),
    transaction({
      commercialAmendmentId: amendmentId,
      providerReference: 'receipt-adjustment',
      amountMinor: 2_500n,
    }),
  ]));
  assert.deepEqual(result, {
    state: 'READY_TO_APPLY',
    readyToApply: true,
    netSettledMinor: 12_500n,
    settledAdjustmentMinor: 2_500n,
    remainingAdjustmentMinor: 0n,
  });
});

test('standalone successful authorization remains in progress until capture', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState({
    ...additionalInput([
      transaction({ providerCode: 'stripe', providerReference: 'pi_base' }),
      transaction({
        commercialAmendmentId: amendmentId,
        kind: 'AUTHORIZATION',
        providerCode: 'stripe',
        providerReference: 'pi_adjustment',
        amountMinor: 2_500n,
      }),
    ]),
    paymentProviderCode: 'stripe',
  });
  assert.equal(result.state, 'IN_PROGRESS');
  if (result.state === 'IN_PROGRESS') {
    assert.match(result.reason, /requires capture/i);
    assert.equal(result.netSettledMinor, 10_000n);
  }
});

test('matching capture makes an authorized additional charge ready without double counting', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState({
    ...additionalInput([
      transaction({ providerCode: 'stripe', providerReference: 'pi_base' }),
      transaction({
        commercialAmendmentId: amendmentId,
        kind: 'AUTHORIZATION',
        providerCode: 'stripe',
        providerReference: 'pi_adjustment',
        amountMinor: 2_500n,
      }),
      transaction({
        commercialAmendmentId: amendmentId,
        kind: 'CAPTURE',
        providerCode: 'stripe',
        providerReference: 'pi_adjustment',
        amountMinor: 2_500n,
      }),
    ]),
    paymentProviderCode: 'stripe',
  });
  assert.equal(result.state, 'READY_TO_APPLY');
});

test('unresolved linked provider work is in progress without pretending money settled', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState(additionalInput([
    transaction(),
    transaction({
      commercialAmendmentId: amendmentId,
      kind: 'CAPTURE',
      status: 'AMBIGUOUS',
      providerCode: 'manual',
      providerReference: 'capture-ambiguous',
      amountMinor: 2_500n,
    }),
  ]));
  assert.equal(result.state, 'IN_PROGRESS');
  if (result.state === 'IN_PROGRESS') assert.equal(result.netSettledMinor, 10_000n);
});

test('definitive failed attempts permit a new execution while preserving failure count', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState(additionalInput([
    transaction(),
    transaction({
      commercialAmendmentId: amendmentId,
      kind: 'OFFLINE_PAYMENT',
      status: 'FAILED',
      providerReference: 'receipt-failed',
      amountMinor: 2_500n,
    }),
  ]));
  assert.deepEqual(result, {
    state: 'REQUIRES_EXECUTION',
    readyToApply: false,
    netSettledMinor: 10_000n,
    settledAdjustmentMinor: 0n,
    remainingAdjustmentMinor: 2_500n,
    failedAttemptCount: 1,
  });
});

test('refund becomes ready only with source-attributed linked refund money', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState(refundInput([
    transaction(),
    transaction({
      commercialAmendmentId: amendmentId,
      kind: 'REFUND',
      providerReference: 'refund-adjustment',
      sourceProviderReference: 'receipt-base',
      amountMinor: 2_500n,
    }),
  ]));
  assert.deepEqual(result, {
    state: 'READY_TO_APPLY',
    readyToApply: true,
    netSettledMinor: 7_500n,
    settledAdjustmentMinor: 2_500n,
    remainingAdjustmentMinor: 0n,
  });
});

test('source-split refund can settle incrementally without losing amendment attribution', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState({
    ...refundInput([
      transaction({ providerReference: 'receipt-a', amountMinor: 4_000n }),
      transaction({ providerReference: 'receipt-b', amountMinor: 6_000n }),
      transaction({
        commercialAmendmentId: amendmentId,
        kind: 'REFUND',
        providerReference: 'refund-partial',
        sourceProviderReference: 'receipt-a',
        amountMinor: 1_500n,
      }),
    ]),
    afterTotalMinor: 6_000n,
    deltaMinor: -4_000n,
  });
  assert.deepEqual(result, {
    state: 'REQUIRES_EXECUTION',
    readyToApply: false,
    netSettledMinor: 8_500n,
    settledAdjustmentMinor: 1_500n,
    remainingAdjustmentMinor: 2_500n,
    failedAttemptCount: 0,
  });
});

test('refund amendment fails closed when source attribution is missing', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState(refundInput([
    transaction(),
    transaction({
      commercialAmendmentId: amendmentId,
      kind: 'REFUND',
      providerReference: 'refund-adjustment',
      amountMinor: 2_500n,
    }),
  ]));
  assert.equal(result.state, 'CONFLICT');
  if (result.state === 'CONFLICT') assert.match(result.reason, /source attribution/i);
});

test('unrelated unresolved payment work fails closed', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState(additionalInput([
    transaction(),
    transaction({
      status: 'PENDING',
      providerReference: 'unrelated-pending',
      amountMinor: 100n,
    }),
  ]));
  assert.equal(result.state, 'CONFLICT');
  if (result.state === 'CONFLICT') assert.match(result.reason, /unrelated payment operation/i);
});

test('linked operation cannot cross the prepared payment provider', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState(additionalInput([
    transaction(),
    transaction({
      commercialAmendmentId: amendmentId,
      providerCode: 'stripe',
      providerReference: 'pi_wrong',
      amountMinor: 2_500n,
    }),
  ]));
  assert.equal(result.state, 'CONFLICT');
  if (result.state === 'CONFLICT') assert.match(result.reason, /different payment provider/i);
});

test('linked operation cannot over-settle the required adjustment', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState(additionalInput([
    transaction(),
    transaction({
      commercialAmendmentId: amendmentId,
      providerReference: 'receipt-too-much',
      amountMinor: 3_000n,
    }),
  ]));
  assert.equal(result.state, 'CONFLICT');
  if (result.state === 'CONFLICT') assert.match(result.reason, /exceeds the required price adjustment/i);
});

test('fails closed when current settlement drifts away from both commercial totals', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState(additionalInput([
    transaction(),
    transaction({
      providerReference: 'unlinked-drift',
      amountMinor: 1_000n,
    }),
  ]));
  assert.equal(result.state, 'CONFLICT');
  if (result.state === 'CONFLICT') assert.match(result.reason, /outside the payment operations/i);
});

test('unresolved linked operation cannot exceed the remaining adjustment', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState(additionalInput([
    transaction(),
    transaction({
      commercialAmendmentId: amendmentId,
      kind: 'CAPTURE',
      status: 'PENDING',
      providerReference: 'capture-too-large',
      amountMinor: 3_000n,
    }),
  ]));
  assert.equal(result.state, 'CONFLICT');
  if (result.state === 'CONFLICT') assert.match(result.reason, /exceeds the required price adjustment|exceeds the remaining price adjustment/i);
});

test('multiple unresolved linked operations fail closed', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState(additionalInput([
    transaction(),
    transaction({
      commercialAmendmentId: amendmentId,
      kind: 'AUTHORIZATION',
      status: 'PENDING',
      providerReference: 'authorization-pending',
      amountMinor: 2_500n,
    }),
    transaction({
      commercialAmendmentId: amendmentId,
      kind: 'CAPTURE',
      status: 'AMBIGUOUS',
      providerReference: 'capture-ambiguous-second',
      amountMinor: 2_500n,
    }),
  ]));
  assert.equal(result.state, 'CONFLICT');
  if (result.state === 'CONFLICT') assert.match(result.reason, /more than one.*unresolved/i);
});

test('fails closed on malformed persisted delta metadata', () => {
  const result = deriveHospitalityCommercialAmendmentSettlementState({
    ...additionalInput([transaction()]),
    deltaMinor: 2_499n,
  });
  assert.equal(result.state, 'CONFLICT');
  if (result.state === 'CONFLICT') assert.match(result.reason, /persisted price delta/i);
});
