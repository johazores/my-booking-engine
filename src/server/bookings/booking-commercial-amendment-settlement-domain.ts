import {
  deriveBookingSettlementSummary,
  type BookingSettlementTransaction,
} from '../payments/payment-settlement-domain.ts';

export type HospitalityCommercialAmendmentSettlementTransaction = BookingSettlementTransaction & Readonly<{
  commercialAmendmentId?: string | null;
}>;

export type HospitalityCommercialAmendmentSettlementState = Readonly<
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

type HospitalityCommercialAmendmentSettlementInput = Readonly<{
  amendmentId: string;
  direction: 'ADDITIONAL_CHARGE' | 'REFUND';
  paymentProviderCode: string;
  currency: string;
  beforeTotalMinor: bigint;
  afterTotalMinor: bigint;
  deltaMinor: bigint;
  transactions: readonly HospitalityCommercialAmendmentSettlementTransaction[];
}>;

function conflict(reason: string): HospitalityCommercialAmendmentSettlementState {
  return Object.freeze({ state: 'CONFLICT', readyToApply: false, reason });
}

function expectedOperationAmount(input: HospitalityCommercialAmendmentSettlementInput): bigint {
  return input.deltaMinor < 0n ? -input.deltaMinor : input.deltaMinor;
}

function expectedNetSettlement(
  input: HospitalityCommercialAmendmentSettlementInput,
  settledAdjustmentMinor: bigint,
) {
  return input.direction === 'ADDITIONAL_CHARGE'
    ? input.beforeTotalMinor + settledAdjustmentMinor
    : input.beforeTotalMinor - settledAdjustmentMinor;
}

function isUnresolved(transaction: HospitalityCommercialAmendmentSettlementTransaction) {
  return transaction.status === 'PENDING' || transaction.status === 'AMBIGUOUS';
}

function isLinked(
  transaction: HospitalityCommercialAmendmentSettlementTransaction,
  amendmentId: string,
) {
  return transaction.commercialAmendmentId === amendmentId;
}

function validateLinkedTransaction(
  transaction: HospitalityCommercialAmendmentSettlementTransaction,
  input: HospitalityCommercialAmendmentSettlementInput,
): string | null {
  if (transaction.providerCode !== input.paymentProviderCode) {
    return 'Commercial amendment payment history crosses a different payment provider.';
  }
  if (transaction.currency !== input.currency) {
    return 'Commercial amendment payment history contains money in a different currency.';
  }
  if (transaction.amountMinor <= 0n) {
    return 'Commercial amendment payment history contains a non-positive amount.';
  }
  if (transaction.amountMinor > expectedOperationAmount(input)) {
    return 'Commercial amendment payment operation exceeds the required price adjustment.';
  }
  if (input.direction === 'ADDITIONAL_CHARGE') {
    if (transaction.kind === 'REFUND') {
      return 'Additional-charge amendment payment history contains an unexpected refund.';
    }
    if (transaction.sourceProviderReference != null) {
      return 'Additional-charge amendment payment history contains unexpected refund-source attribution.';
    }
    return null;
  }

  if (transaction.kind !== 'REFUND') {
    return 'Refund amendment payment history contains an unexpected non-refund transaction.';
  }
  if (!transaction.sourceProviderReference?.trim()) {
    return 'Refund amendment payment history is missing settlement-source attribution.';
  }
  return null;
}

function linkedSettledAmount(
  linked: readonly HospitalityCommercialAmendmentSettlementTransaction[],
  direction: HospitalityCommercialAmendmentSettlementInput['direction'],
): bigint {
  if (direction === 'REFUND') {
    return linked
      .filter((transaction) => transaction.status === 'SUCCEEDED' && transaction.kind === 'REFUND')
      .reduce((total, transaction) => total + transaction.amountMinor, 0n);
  }

  return linked
    .filter((transaction) => (
      transaction.status === 'SUCCEEDED'
      && (transaction.kind === 'OFFLINE_PAYMENT' || transaction.kind === 'CAPTURE')
    ))
    .reduce((total, transaction) => total + transaction.amountMinor, 0n);
}

function stripStandaloneLinkedAuthorizations(
  transactions: readonly HospitalityCommercialAmendmentSettlementTransaction[],
  amendmentId: string,
) {
  const successfulCaptureReferences = new Set(
    transactions
      .filter((transaction) => (
        isLinked(transaction, amendmentId)
        && transaction.status === 'SUCCEEDED'
        && transaction.kind === 'CAPTURE'
      ))
      .map((transaction) => `${transaction.providerCode}\u001f${transaction.providerReference}`),
  );

  return transactions.filter((transaction) => {
    if (
      !isLinked(transaction, amendmentId)
      || transaction.kind !== 'AUTHORIZATION'
      || transaction.status !== 'SUCCEEDED'
    ) return true;
    return successfulCaptureReferences.has(`${transaction.providerCode}\u001f${transaction.providerReference}`);
  });
}

export function deriveHospitalityCommercialAmendmentSettlementState(
  input: HospitalityCommercialAmendmentSettlementInput,
): HospitalityCommercialAmendmentSettlementState {
  if (!input.amendmentId.trim() || !input.paymentProviderCode.trim()) {
    return conflict('Commercial amendment settlement identity is incomplete.');
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    return conflict('Commercial amendment currency is invalid.');
  }
  if (input.beforeTotalMinor < 0n || input.afterTotalMinor < 0n) {
    return conflict('Commercial amendment totals cannot be negative.');
  }
  if (input.afterTotalMinor - input.beforeTotalMinor !== input.deltaMinor || input.deltaMinor === 0n) {
    return conflict('Commercial amendment totals do not match the persisted price delta.');
  }
  if (
    (input.direction === 'ADDITIONAL_CHARGE' && input.deltaMinor <= 0n)
    || (input.direction === 'REFUND' && input.deltaMinor >= 0n)
  ) {
    return conflict('Commercial amendment direction does not match the persisted price delta.');
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
    return conflict('An unrelated payment operation is unresolved while the commercial amendment is active.');
  }

  const settledAdjustmentMinor = linkedSettledAmount(linked, input.direction);
  const expectedMinor = expectedOperationAmount(input);
  if (settledAdjustmentMinor > expectedMinor) {
    return conflict('Commercial amendment payment history exceeds the required price adjustment.');
  }
  const remainingAdjustmentMinor = expectedMinor - settledAdjustmentMinor;

  const settlementTransactions = stripStandaloneLinkedAuthorizations(input.transactions, input.amendmentId);
  const unresolvedLinked = linked.filter(isUnresolved);
  const resolvedTransactions = settlementTransactions.filter((transaction) => !isUnresolved(transaction));
  const resolvedSummary = deriveBookingSettlementSummary({
    currency: input.currency,
    transactions: resolvedTransactions,
  });
  if (!resolvedSummary.reconciled) return conflict(resolvedSummary.reason);

  const expectedNetSettledMinor = expectedNetSettlement(input, settledAdjustmentMinor);
  if (resolvedSummary.netSettledMinor !== expectedNetSettledMinor) {
    return conflict('Authoritative net settlement changed outside the payment operations linked to this commercial amendment.');
  }

  if (unresolvedLinked.length > 1) {
    return conflict('More than one commercial amendment payment operation is unresolved.');
  }
  if (unresolvedLinked.length === 1 && unresolvedLinked[0]!.amountMinor > remainingAdjustmentMinor) {
    return conflict('Unresolved commercial amendment payment operation exceeds the remaining price adjustment.');
  }
  if (unresolvedLinked.length > 0) {
    return Object.freeze({
      state: 'IN_PROGRESS',
      readyToApply: false,
      netSettledMinor: resolvedSummary.netSettledMinor,
      settledAdjustmentMinor,
      remainingAdjustmentMinor,
      reason: 'Commercial amendment payment operation is still unresolved.',
    });
  }

  const successfulStandaloneAuthorization = linked.some((transaction) => (
    transaction.status === 'SUCCEEDED'
    && transaction.kind === 'AUTHORIZATION'
    && !linked.some((candidate) => (
      candidate.status === 'SUCCEEDED'
      && candidate.kind === 'CAPTURE'
      && candidate.providerCode === transaction.providerCode
      && candidate.providerReference === transaction.providerReference
    ))
  ));
  if (successfulStandaloneAuthorization) {
    return Object.freeze({
      state: 'IN_PROGRESS',
      readyToApply: false,
      netSettledMinor: resolvedSummary.netSettledMinor,
      settledAdjustmentMinor,
      remainingAdjustmentMinor,
      reason: 'Commercial amendment payment is authorized but still requires capture.',
    });
  }

  if (remainingAdjustmentMinor > 0n) {
    return Object.freeze({
      state: 'REQUIRES_EXECUTION',
      readyToApply: false,
      netSettledMinor: resolvedSummary.netSettledMinor,
      settledAdjustmentMinor,
      remainingAdjustmentMinor,
      failedAttemptCount: linked.filter((transaction) => transaction.status === 'FAILED').length,
    });
  }

  if (resolvedSummary.netSettledMinor !== input.afterTotalMinor) {
    return conflict('Authoritative net settlement does not match the amended booking total.');
  }

  return Object.freeze({
    state: 'READY_TO_APPLY',
    readyToApply: true,
    netSettledMinor: resolvedSummary.netSettledMinor,
    settledAdjustmentMinor,
    remainingAdjustmentMinor: 0n,
  });
}
