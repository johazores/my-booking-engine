import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveHospitalityCommercialAmendmentExecutionDecision } from './booking-commercial-amendment-execution-domain.ts';

const now = new Date('2026-09-03T03:00:00.000Z');
const expiresAt = new Date('2026-09-03T03:15:00.000Z');

function requiresExecution(overrides: Record<string, unknown> = {}) {
  return {
    state: 'REQUIRES_EXECUTION' as const,
    readyToApply: false as const,
    netSettledMinor: 10_000n,
    settledAdjustmentMinor: 0n,
    remainingAdjustmentMinor: 2_500n,
    failedAttemptCount: 0,
    ...overrides,
  };
}

function base(overrides: Record<string, unknown> = {}) {
  return {
    status: 'PREPARED' as const,
    direction: 'ADDITIONAL_CHARGE' as const,
    paymentProviderCode: 'manual',
    currency: 'AUD',
    expiresAt,
    now,
    settlement: requiresExecution(),
    ...overrides,
  };
}

test('plans exact remaining additional charge', () => {
  assert.deepEqual(deriveHospitalityCommercialAmendmentExecutionDecision(base()), {
    state: 'EXECUTE',
    operation: 'ADDITIONAL_CHARGE',
    providerCode: 'manual',
    currency: 'AUD',
    amountMinor: 2_500n,
  });
});

test('plans deterministic source-scoped refund and never spans a source', () => {
  assert.deepEqual(deriveHospitalityCommercialAmendmentExecutionDecision(base({
    direction: 'REFUND',
    settlement: requiresExecution({ remainingAdjustmentMinor: 5_000n }),
    refundAllocation: {
      allocated: true,
      providerCode: 'manual',
      providerReference: 'source-b',
      sourceKind: 'OFFLINE_PAYMENT',
      currency: 'AUD',
      sourceRefundableMinor: 3_000n,
      bookingRefundableMinor: 10_000n,
      refundableSourceCount: 2,
    },
  })), {
    state: 'EXECUTE',
    operation: 'REFUND',
    providerCode: 'manual',
    sourceProviderReference: 'source-b',
    sourceKind: 'OFFLINE_PAYMENT',
    currency: 'AUD',
    amountMinor: 3_000n,
    sourceRefundableMinor: 3_000n,
    bookingRefundableMinor: 10_000n,
    refundableSourceCount: 2,
  });
});

test('refund allocation provider and currency must match the prepared amendment', () => {
  const result = deriveHospitalityCommercialAmendmentExecutionDecision(base({
    direction: 'REFUND',
    refundAllocation: {
      allocated: true,
      providerCode: 'stripe',
      providerReference: 'pi_123',
      sourceKind: 'CAPTURE',
      currency: 'AUD',
      sourceRefundableMinor: 2_500n,
      bookingRefundableMinor: 2_500n,
      refundableSourceCount: 1,
    },
  }));
  assert.equal(result.state, 'CONFLICT');
});

test('unresolved provider operation prevents a second execution', () => {
  const result = deriveHospitalityCommercialAmendmentExecutionDecision(base({
    settlement: {
      state: 'IN_PROGRESS',
      readyToApply: false,
      netSettledMinor: 10_000n,
      settledAdjustmentMinor: 0n,
      remainingAdjustmentMinor: 2_500n,
      reason: 'provider operation unresolved',
    },
  }));
  assert.deepEqual(result, { state: 'WAIT_FOR_PROVIDER', reason: 'provider operation unresolved' });
});

test('settled amendment is ready to apply and does not execute again', () => {
  const result = deriveHospitalityCommercialAmendmentExecutionDecision(base({
    settlement: {
      state: 'READY_TO_APPLY',
      readyToApply: true,
      netSettledMinor: 12_500n,
      settledAdjustmentMinor: 2_500n,
      remainingAdjustmentMinor: 0n,
    },
  }));
  assert.deepEqual(result, { state: 'READY_TO_APPLY' });
});

test('expired amendment without settled adjustment cannot start money movement', () => {
  const result = deriveHospitalityCommercialAmendmentExecutionDecision(base({
    now: new Date('2026-09-03T03:16:00.000Z'),
  }));
  assert.equal(result.state, 'EXPIRED');
});

test('expired amendment with partial settled money requires recovery', () => {
  const result = deriveHospitalityCommercialAmendmentExecutionDecision(base({
    now: new Date('2026-09-03T03:16:00.000Z'),
    settlement: requiresExecution({ settledAdjustmentMinor: 1_000n, remainingAdjustmentMinor: 1_500n }),
  }));
  assert.equal(result.state, 'RECOVERY_REQUIRED');
});

test('expired amendment with unresolved provider activity requires recovery', () => {
  const result = deriveHospitalityCommercialAmendmentExecutionDecision(base({
    now: new Date('2026-09-03T03:16:00.000Z'),
    settlement: {
      state: 'IN_PROGRESS',
      readyToApply: false,
      netSettledMinor: 10_000n,
      settledAdjustmentMinor: 0n,
      remainingAdjustmentMinor: 2_500n,
      reason: 'provider operation unresolved',
    },
  }));
  assert.equal(result.state, 'RECOVERY_REQUIRED');
});

test('terminal amendment never returns an execution action', () => {
  assert.deepEqual(deriveHospitalityCommercialAmendmentExecutionDecision(base({ status: 'APPLIED' })), {
    state: 'TERMINAL',
    status: 'APPLIED',
    reason: 'Commercial amendment is already applied.',
  });
});

test('unsupported provider fails closed', () => {
  const result = deriveHospitalityCommercialAmendmentExecutionDecision(base({ paymentProviderCode: 'future-provider' }));
  assert.equal(result.state, 'CONFLICT');
});
