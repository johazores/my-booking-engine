import { deriveNextBookingRefundSource } from '../payments/payment-refund-allocation-domain.ts';
import {
  deriveBookingSettlementSummary,
  type BookingSettlementTransaction,
} from '../payments/payment-settlement-domain.ts';

export type HospitalityCommercialAmendmentRecoveryTransaction = BookingSettlementTransaction & Readonly<{
  commercialAmendmentId?: string | null;
  createdAt: Date;
}>;

export type HospitalityCommercialAmendmentRecoveryDecision = Readonly<
  | { state: 'NOT_EXPIRED'; reason: string }
  | { state: 'TERMINAL'; status: 'CANCELLED' | 'EXPIRED' | 'APPLIED'; reason: string }
  | { state: 'WAIT_FOR_PROVIDER'; reason: string }
  | {
    state: 'RELEASE_AUTHORIZATION';
    providerCode: 'stripe';
    providerReference: string;
    currency: string;
    amountMinor: bigint;
    reason: string;
  }
  | {
    state: 'CAPTURE_COMPENSATION';
    providerCode: 'stripe';
    providerReference: string;
    currency: string;
    amountMinor: bigint;
    reason: string;
  }
  | {
    state: 'COMPENSATE';
    operation: 'ADDITIONAL_CHARGE';
    providerCode: 'manual' | 'stripe';
    currency: string;
    amountMinor: bigint;
    reason: string;
  }
  | {
    state: 'COMPENSATE';
    operation: 'REFUND';
    providerCode: 'manual' | 'stripe';
    sourceProviderReference: string;
    sourceKind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE';
    currency: string;
    amountMinor: bigint;
    sourceRefundableMinor: bigint;
    remainingRecoveryMinor: bigint;
    reason: string;
  }
  | {
    state: 'READY_TO_EXPIRE';
    netSettledMinor: bigint;
    reason: string;
  }
  | { state: 'CONFLICT'; reason: string }
>;

export type HospitalityCommercialAmendmentRecoveryInput = Readonly<{
  amendmentId: string;
  status: 'PREPARED' | 'CANCELLED' | 'EXPIRED' | 'APPLIED';
  direction: 'ADDITIONAL_CHARGE' | 'REFUND';
  paymentProviderCode: string;
  currency: string;
  beforeTotalMinor: bigint;
  afterTotalMinor: bigint;
  deltaMinor: bigint;
  createdAt: Date;
  expiresAt: Date;
  now: Date;
  transactions: readonly HospitalityCommercialAmendmentRecoveryTransaction[];
}>;

function conflict(reason: string): HospitalityCommercialAmendmentRecoveryDecision {
  return { state: 'CONFLICT', reason };
}

function supportedProvider(value: string): 'manual' | 'stripe' | null {
  return value === 'manual' || value === 'stripe' ? value : null;
}

function transactionKey(transaction: Pick<BookingSettlementTransaction, 'providerCode' | 'providerReference'>) {
  return `${transaction.providerCode}\u001f${transaction.providerReference}`;
}

function isLinked(transaction: HospitalityCommercialAmendmentRecoveryTransaction, amendmentId: string) {
  return transaction.commercialAmendmentId === amendmentId;
}

function isUnresolved(transaction: HospitalityCommercialAmendmentRecoveryTransaction) {
  return transaction.status === 'PENDING' || transaction.status === 'AMBIGUOUS';
}

function validateLinkedTransaction(
  transaction: HospitalityCommercialAmendmentRecoveryTransaction,
  input: HospitalityCommercialAmendmentRecoveryInput,
): string | null {
  if (transaction.providerCode !== input.paymentProviderCode) {
    return 'Commercial amendment recovery history crosses a different payment provider.';
  }
  if (transaction.currency !== input.currency) {
    return 'Commercial amendment recovery history contains money in a different currency.';
  }
  if (transaction.amountMinor <= 0n) {
    return 'Commercial amendment recovery history contains a non-positive amount.';
  }
  if (!transaction.providerReference.trim()) {
    return 'Commercial amendment recovery history is missing provider identity.';
  }
  if (transaction.kind === 'REFUND') {
    if (!transaction.sourceProviderReference?.trim()) {
      return 'Commercial amendment recovery refund is missing settlement-source attribution.';
    }
  } else if (transaction.sourceProviderReference != null) {
    return 'Commercial amendment recovery contains refund-source attribution on a non-refund transaction.';
  }
  return null;
}

function successfulStandaloneAuthorizations(
  linked: readonly HospitalityCommercialAmendmentRecoveryTransaction[],
) {
  const successfulCaptureReferences = new Set(
    linked
      .filter((transaction) => transaction.status === 'SUCCEEDED' && transaction.kind === 'CAPTURE')
      .map(transactionKey),
  );
  return linked.filter((transaction) => (
    transaction.status === 'SUCCEEDED'
    && transaction.kind === 'AUTHORIZATION'
    && !successfulCaptureReferences.has(transactionKey(transaction))
  ));
}

function stripStandaloneLinkedAuthorizations(
  transactions: readonly HospitalityCommercialAmendmentRecoveryTransaction[],
  standaloneAuthorizations: readonly HospitalityCommercialAmendmentRecoveryTransaction[],
) {
  const standalone = new Set(standaloneAuthorizations.map(transactionKey));
  return transactions.filter((transaction) => !(
    transaction.status === 'SUCCEEDED'
    && transaction.kind === 'AUTHORIZATION'
    && standalone.has(transactionKey(transaction))
  ));
}

function linkedSuccessfulNetEffect(
  linked: readonly HospitalityCommercialAmendmentRecoveryTransaction[],
  standaloneAuthorizations: readonly HospitalityCommercialAmendmentRecoveryTransaction[],
) {
  const standalone = new Set(standaloneAuthorizations.map(transactionKey));
  const successfulCaptureReferences = new Set(
    linked
      .filter((transaction) => transaction.status === 'SUCCEEDED' && transaction.kind === 'CAPTURE')
      .map(transactionKey),
  );

  let effect = 0n;
  for (const transaction of linked) {
    if (transaction.status !== 'SUCCEEDED') continue;
    if (transaction.kind === 'REFUND') {
      effect -= transaction.amountMinor;
      continue;
    }
    if (transaction.kind === 'AUTHORIZATION') {
      if (standalone.has(transactionKey(transaction))) continue;
      if (successfulCaptureReferences.has(transactionKey(transaction))) continue;
    }
    effect += transaction.amountMinor;
  }
  return effect;
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

export function deriveHospitalityCommercialAmendmentRecoveryDecision(
  input: HospitalityCommercialAmendmentRecoveryInput,
): HospitalityCommercialAmendmentRecoveryDecision {
  if (input.status !== 'PREPARED') {
    return {
      state: 'TERMINAL',
      status: input.status,
      reason: input.status === 'APPLIED'
        ? 'Commercial amendment is already applied.'
        : `Commercial amendment is already ${input.status.toLowerCase()}.`,
    };
  }
  if (!input.amendmentId.trim()) return conflict('Commercial amendment recovery identity is incomplete.');
  const providerCode = supportedProvider(input.paymentProviderCode);
  if (!providerCode) return conflict('Commercial amendment recovery provider is not supported.');
  if (!/^[A-Z]{3}$/.test(input.currency)) return conflict('Commercial amendment recovery currency is invalid.');
  if (input.beforeTotalMinor < 0n || input.afterTotalMinor < 0n) {
    return conflict('Commercial amendment recovery totals cannot be negative.');
  }
  if (input.afterTotalMinor - input.beforeTotalMinor !== input.deltaMinor || input.deltaMinor === 0n) {
    return conflict('Commercial amendment recovery totals do not match the persisted price delta.');
  }
  if (
    (input.direction === 'ADDITIONAL_CHARGE' && input.deltaMinor <= 0n)
    || (input.direction === 'REFUND' && input.deltaMinor >= 0n)
  ) {
    return conflict('Commercial amendment recovery direction does not match the persisted price delta.');
  }
  if (input.createdAt.getTime() >= input.expiresAt.getTime()) {
    return conflict('Commercial amendment recovery window is invalid.');
  }
  if (input.expiresAt.getTime() > input.now.getTime()) {
    return { state: 'NOT_EXPIRED', reason: 'Commercial amendment has not expired.' };
  }

  const linked = input.transactions.filter((transaction) => isLinked(transaction, input.amendmentId));
  for (const transaction of linked) {
    const reason = validateLinkedTransaction(transaction, input);
    if (reason) return conflict(reason);
  }

  const unrelatedUnresolved = input.transactions.find((transaction) => (
    !isLinked(transaction, input.amendmentId) && isUnresolved(transaction)
  ));
  if (unrelatedUnresolved) {
    return conflict('An unrelated payment operation is unresolved while commercial amendment recovery is required.');
  }
  const unrelatedPostPrepareSuccess = input.transactions.find((transaction) => (
    !isLinked(transaction, input.amendmentId)
    && transaction.status === 'SUCCEEDED'
    && transaction.createdAt.getTime() >= input.createdAt.getTime()
  ));
  if (unrelatedPostPrepareSuccess) {
    return conflict('Successful booking money changed outside the commercial amendment after it was prepared.');
  }

  const unresolvedLinked = linked.filter(isUnresolved);
  if (unresolvedLinked.length > 0) {
    return {
      state: 'WAIT_FOR_PROVIDER',
      reason: unresolvedLinked.length === 1
        ? 'Commercial amendment payment evidence is still unresolved at the provider.'
        : 'Multiple commercial amendment payment operations are unresolved and require provider reconciliation.',
    };
  }

  const standaloneAuthorizations = successfulStandaloneAuthorizations(linked);
  if (standaloneAuthorizations.length > 1) {
    return conflict('Commercial amendment recovery found multiple uncaptured authorizations.');
  }
  const standaloneAuthorization = standaloneAuthorizations[0] ?? null;
  if (standaloneAuthorization && providerCode !== 'stripe') {
    return conflict('Only Stripe authorization recovery is supported for an uncaptured commercial amendment authorization.');
  }

  const settlementTransactions = stripStandaloneLinkedAuthorizations(input.transactions, standaloneAuthorizations);
  const summary = deriveBookingSettlementSummary({
    currency: input.currency,
    transactions: settlementTransactions,
  });
  if (!summary.reconciled) return conflict(summary.reason);

  const preparedProvider = summary.providers.find((provider) => provider.providerCode === providerCode);
  if (!preparedProvider && input.beforeTotalMinor > 0n) {
    return conflict('Authoritative booking settlement no longer contains the prepared payment provider.');
  }
  if (summary.providers.some((provider) => provider.providerCode !== providerCode)) {
    return conflict('Authoritative booking settlement crosses a different provider during commercial amendment recovery.');
  }

  const linkedEffect = linkedSuccessfulNetEffect(linked, standaloneAuthorizations);
  if (summary.netSettledMinor !== input.beforeTotalMinor + linkedEffect) {
    return conflict('Authoritative net settlement changed outside payment evidence linked to this commercial amendment.');
  }

  const lowerBound = input.beforeTotalMinor < input.afterTotalMinor ? input.beforeTotalMinor : input.afterTotalMinor;
  const upperBound = input.beforeTotalMinor > input.afterTotalMinor ? input.beforeTotalMinor : input.afterTotalMinor;
  if (summary.netSettledMinor < lowerBound || summary.netSettledMinor > upperBound) {
    return conflict('Commercial amendment recovery money moved outside the prepared before/after price boundary.');
  }

  if (standaloneAuthorization) {
    if (input.direction === 'ADDITIONAL_CHARGE') {
      if (standaloneAuthorization.amountMinor > input.deltaMinor) {
        return conflict('Expired commercial amendment authorization exceeds the prepared additional-charge amount.');
      }
      return {
        state: 'RELEASE_AUTHORIZATION',
        providerCode: 'stripe',
        providerReference: standaloneAuthorization.providerReference,
        currency: input.currency,
        amountMinor: standaloneAuthorization.amountMinor,
        reason: 'Expired additional-charge amendment still has an uncaptured authorization that must be released before recovery can finish.',
      };
    }

    const recoveryMinor = input.beforeTotalMinor - summary.netSettledMinor;
    if (recoveryMinor <= 0n) {
      return {
        state: 'RELEASE_AUTHORIZATION',
        providerCode: 'stripe',
        providerReference: standaloneAuthorization.providerReference,
        currency: input.currency,
        amountMinor: standaloneAuthorization.amountMinor,
        reason: 'Refund-amendment recovery no longer needs its uncaptured compensation authorization, so it must be released.',
      };
    }
    if (standaloneAuthorization.amountMinor !== recoveryMinor) {
      return conflict('Refund-amendment compensation authorization does not match the exact remaining recovery amount.');
    }
    return {
      state: 'CAPTURE_COMPENSATION',
      providerCode: 'stripe',
      providerReference: standaloneAuthorization.providerReference,
      currency: input.currency,
      amountMinor: recoveryMinor,
      reason: 'Refund-amendment recovery already has an authorized compensation charge that must be captured or reconciled.',
    };
  }

  if (summary.netSettledMinor === input.beforeTotalMinor) {
    return {
      state: 'READY_TO_EXPIRE',
      netSettledMinor: summary.netSettledMinor,
      reason: 'Authoritative booking settlement has been restored to the pre-amendment total.',
    };
  }

  if (summary.netSettledMinor > input.beforeTotalMinor) {
    const recoveryMinor = summary.netSettledMinor - input.beforeTotalMinor;
    const linkedSourceKeys = new Set(
      linked
        .filter((transaction) => (
          transaction.status === 'SUCCEEDED'
          && (transaction.kind === 'OFFLINE_PAYMENT' || transaction.kind === 'CAPTURE')
        ))
        .map(transactionKey),
    );
    const amendmentSources = summary.sources.filter((source) => (
      linkedSourceKeys.has(`${source.providerCode}\u001f${source.providerReference}`)
    ));
    const allocation = deriveNextBookingRefundSource({ sources: amendmentSources });
    if (!allocation.allocated) {
      return conflict(`Commercial amendment recovery cannot identify refundable adjustment money: ${allocation.reason}`);
    }
    if (allocation.providerCode !== providerCode || allocation.currency !== input.currency) {
      return conflict('Commercial amendment recovery refund source does not match the prepared provider and currency.');
    }
    return {
      state: 'COMPENSATE',
      operation: 'REFUND',
      providerCode,
      sourceProviderReference: allocation.providerReference,
      sourceKind: allocation.sourceKind,
      currency: input.currency,
      amountMinor: minimum(recoveryMinor, allocation.sourceRefundableMinor),
      sourceRefundableMinor: allocation.sourceRefundableMinor,
      remainingRecoveryMinor: recoveryMinor,
      reason: 'Expired commercial amendment settled more than the original booking total and must refund the adjustment-created settlement source.',
    };
  }

  const recoveryMinor = input.beforeTotalMinor - summary.netSettledMinor;
  return {
    state: 'COMPENSATE',
    operation: 'ADDITIONAL_CHARGE',
    providerCode,
    currency: input.currency,
    amountMinor: recoveryMinor,
    reason: 'Expired commercial amendment settled below the original booking total and requires a compensation charge before it can be closed.',
  };
}
