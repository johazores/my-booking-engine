export type CommercialAmendmentExecutionSettlement = Readonly<
  | {
    state: 'REQUIRES_EXECUTION';
    readyToApply: false;
    netSettledMinor: bigint;
    settledAdjustmentMinor: bigint;
    remainingAdjustmentMinor: bigint;
    failedAttemptCount: number;
  }
  | {
    state: 'IN_PROGRESS';
    readyToApply: false;
    netSettledMinor: bigint;
    settledAdjustmentMinor: bigint;
    remainingAdjustmentMinor: bigint;
    reason: string;
  }
  | {
    state: 'READY_TO_APPLY';
    readyToApply: true;
    netSettledMinor: bigint;
    settledAdjustmentMinor: bigint;
    remainingAdjustmentMinor: 0n;
  }
  | {
    state: 'CONFLICT';
    readyToApply: false;
    reason: string;
  }
>;

export type CommercialAmendmentRefundAllocation = Readonly<
  | {
    allocated: true;
    providerCode: string;
    providerReference: string;
    sourceKind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE';
    currency: string;
    sourceRefundableMinor: bigint;
    bookingRefundableMinor: bigint;
    refundableSourceCount: number;
  }
  | { allocated: false; reason: string }
>;

export type HospitalityCommercialAmendmentExecutionDecision = Readonly<
  | {
    state: 'EXECUTE';
    operation: 'ADDITIONAL_CHARGE';
    providerCode: 'manual' | 'stripe';
    currency: string;
    amountMinor: bigint;
  }
  | {
    state: 'EXECUTE';
    operation: 'REFUND';
    providerCode: 'manual' | 'stripe';
    sourceProviderReference: string;
    sourceKind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE';
    currency: string;
    amountMinor: bigint;
    sourceRefundableMinor: bigint;
    bookingRefundableMinor: bigint;
    refundableSourceCount: number;
  }
  | { state: 'WAIT_FOR_PROVIDER'; reason: string }
  | { state: 'READY_TO_APPLY' }
  | { state: 'RECOVERY_REQUIRED'; reason: string }
  | { state: 'EXPIRED'; reason: string }
  | {
    state: 'TERMINAL';
    status: 'CANCELLED' | 'EXPIRED' | 'APPLIED';
    reason: string;
  }
  | { state: 'CONFLICT'; reason: string }
>;

export type HospitalityCommercialAmendmentExecutionDecisionInput = Readonly<{
  status: 'PREPARED' | 'CANCELLED' | 'EXPIRED' | 'APPLIED';
  direction: 'ADDITIONAL_CHARGE' | 'REFUND';
  paymentProviderCode: string;
  currency: string;
  expiresAt: Date;
  now: Date;
  settlement: CommercialAmendmentExecutionSettlement;
  refundAllocation?: CommercialAmendmentRefundAllocation | null;
}>;

function supportedProvider(providerCode: string): 'manual' | 'stripe' | null {
  return providerCode === 'manual' || providerCode === 'stripe' ? providerCode : null;
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

export function deriveHospitalityCommercialAmendmentExecutionDecision(
  input: HospitalityCommercialAmendmentExecutionDecisionInput,
): HospitalityCommercialAmendmentExecutionDecision {
  if (input.status !== 'PREPARED') {
    return {
      state: 'TERMINAL',
      status: input.status,
      reason: input.status === 'APPLIED'
        ? 'Commercial amendment is already applied.'
        : `Commercial amendment is already ${input.status.toLowerCase()}.`,
    };
  }

  const providerCode = supportedProvider(input.paymentProviderCode);
  if (!providerCode) {
    return {
      state: 'CONFLICT',
      reason: 'Commercial amendment payment provider is not supported for execution.',
    };
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    return { state: 'CONFLICT', reason: 'Commercial amendment execution currency is invalid.' };
  }

  if (input.settlement.state === 'CONFLICT') {
    return { state: 'CONFLICT', reason: input.settlement.reason };
  }

  const expired = input.expiresAt.getTime() <= input.now.getTime();
  if (expired) {
    if (
      input.settlement.state === 'REQUIRES_EXECUTION'
      && input.settlement.settledAdjustmentMinor === 0n
    ) {
      return {
        state: 'EXPIRED',
        reason: 'Commercial amendment expired before any adjustment money settled.',
      };
    }
    return {
      state: 'RECOVERY_REQUIRED',
      reason: 'Commercial amendment expired after adjustment payment activity began. Reconcile or compensate the external money before continuing.',
    };
  }

  if (input.settlement.state === 'IN_PROGRESS') {
    return { state: 'WAIT_FOR_PROVIDER', reason: input.settlement.reason };
  }
  if (input.settlement.state === 'READY_TO_APPLY') {
    return { state: 'READY_TO_APPLY' };
  }
  if (input.settlement.remainingAdjustmentMinor <= 0n) {
    return { state: 'CONFLICT', reason: 'Commercial amendment has no positive adjustment amount remaining.' };
  }

  if (input.direction === 'ADDITIONAL_CHARGE') {
    return {
      state: 'EXECUTE',
      operation: 'ADDITIONAL_CHARGE',
      providerCode,
      currency: input.currency,
      amountMinor: input.settlement.remainingAdjustmentMinor,
    };
  }

  const allocation = input.refundAllocation;
  if (!allocation) {
    return {
      state: 'CONFLICT',
      reason: 'Commercial amendment refund allocation is required before execution.',
    };
  }
  if (!allocation.allocated) return { state: 'CONFLICT', reason: allocation.reason };
  if (allocation.providerCode !== providerCode || allocation.currency !== input.currency) {
    return {
      state: 'CONFLICT',
      reason: 'Commercial amendment refund source does not match the prepared payment provider and currency.',
    };
  }
  const amountMinor = minimum(
    input.settlement.remainingAdjustmentMinor,
    allocation.sourceRefundableMinor,
  );
  if (amountMinor <= 0n) {
    return {
      state: 'CONFLICT',
      reason: 'Commercial amendment refund has no positive source-scoped amount remaining.',
    };
  }

  return {
    state: 'EXECUTE',
    operation: 'REFUND',
    providerCode,
    sourceProviderReference: allocation.providerReference,
    sourceKind: allocation.sourceKind,
    currency: allocation.currency,
    amountMinor,
    sourceRefundableMinor: allocation.sourceRefundableMinor,
    bookingRefundableMinor: allocation.bookingRefundableMinor,
    refundableSourceCount: allocation.refundableSourceCount,
  };
}
