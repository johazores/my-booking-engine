export type BookingSettlementTransaction = Readonly<{
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  providerCode: string;
  providerReference: string;
  currency: string;
  amountMinor: bigint;
}>;

export type BookingSettlementSource = Readonly<{
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE';
  providerCode: string;
  providerReference: string;
  currency: string;
  amountMinor: bigint;
}>;

export type BookingSettlementProviderSummary = Readonly<{
  providerCode: string;
  grossSettledMinor: bigint;
  refundedMinor: bigint;
  netSettledMinor: bigint;
  sourceCount: number;
}>;

export type BookingSettlementSummary = Readonly<
  | {
    reconciled: true;
    currency: string;
    grossSettledMinor: bigint;
    refundedMinor: bigint;
    netSettledMinor: bigint;
    sources: readonly BookingSettlementSource[];
    providers: readonly BookingSettlementProviderSummary[];
  }
  | {
    reconciled: false;
    reason: string;
  }
>;

type BookingSettlementInput = Readonly<{
  currency: string;
  transactions: readonly BookingSettlementTransaction[];
}>;

const INTERNAL_CLAIM_REFERENCE = /^sf_claim_[0-9a-f]{64}$/;

function isUnresolved(transaction: BookingSettlementTransaction) {
  return transaction.status === 'PENDING' || transaction.status === 'AMBIGUOUS';
}

function isSuccessfulSettlementKind(transaction: BookingSettlementTransaction) {
  return transaction.status === 'SUCCEEDED'
    && (transaction.kind === 'OFFLINE_PAYMENT' || transaction.kind === 'AUTHORIZATION' || transaction.kind === 'CAPTURE');
}

function validateSuccessfulTransaction(
  transaction: BookingSettlementTransaction,
  currency: string,
): string | null {
  if (transaction.currency !== currency) {
    return 'Successful payment history contains money in a different currency. Reconcile payment history before continuing.';
  }
  if (transaction.amountMinor <= 0n) {
    return 'Successful payment history contains a non-positive amount. Reconcile payment history before continuing.';
  }
  if (!transaction.providerCode.trim() || !transaction.providerReference.trim()) {
    return 'Successful payment history is missing provider identity. Reconcile payment history before continuing.';
  }
  if (INTERNAL_CLAIM_REFERENCE.test(transaction.providerReference)) {
    return 'Successful payment history still contains an internal provider claim. Reconcile payment history before continuing.';
  }
  return null;
}

export function deriveBookingSettlementSummary(input: BookingSettlementInput): BookingSettlementSummary {
  if (input.transactions.some(isUnresolved)) {
    return {
      reconciled: false,
      reason: 'A payment operation is still unresolved. Reconcile payment history before continuing.',
    };
  }

  const successful = input.transactions.filter((transaction) => transaction.status === 'SUCCEEDED');
  for (const transaction of successful) {
    const invalidReason = validateSuccessfulTransaction(transaction, input.currency);
    if (invalidReason) return { reconciled: false, reason: invalidReason };
  }

  const successfulCaptures = new Set(
    successful
      .filter((transaction) => transaction.kind === 'CAPTURE')
      .map((transaction) => `${transaction.providerCode}\u001f${transaction.providerReference}`),
  );
  const sources = successful
    .filter(isSuccessfulSettlementKind)
    .filter((transaction) => (
      transaction.kind !== 'AUTHORIZATION'
      || !successfulCaptures.has(`${transaction.providerCode}\u001f${transaction.providerReference}`)
    ))
    .map((transaction): BookingSettlementSource => ({
      kind: transaction.kind as BookingSettlementSource['kind'],
      providerCode: transaction.providerCode,
      providerReference: transaction.providerReference,
      currency: transaction.currency,
      amountMinor: transaction.amountMinor,
    }));

  const seenSourceReferences = new Set<string>();
  for (const source of sources) {
    const key = `${source.providerCode}\u001f${source.providerReference}`;
    if (seenSourceReferences.has(key)) {
      return {
        reconciled: false,
        reason: 'Successful payment history contains a duplicate settlement reference. Reconcile payment history before continuing.',
      };
    }
    seenSourceReferences.add(key);
  }

  const providerAmounts = new Map<string, { grossSettledMinor: bigint; refundedMinor: bigint; sourceCount: number }>();
  for (const source of sources) {
    const current = providerAmounts.get(source.providerCode) ?? {
      grossSettledMinor: 0n,
      refundedMinor: 0n,
      sourceCount: 0,
    };
    current.grossSettledMinor += source.amountMinor;
    current.sourceCount += 1;
    providerAmounts.set(source.providerCode, current);
  }

  const successfulRefunds = successful.filter((transaction) => transaction.kind === 'REFUND');
  const seenRefundReferences = new Set<string>();
  for (const refund of successfulRefunds) {
    const refundKey = `${refund.providerCode}\u001f${refund.providerReference}`;
    if (seenRefundReferences.has(refundKey)) {
      return {
        reconciled: false,
        reason: 'Successful payment history contains a duplicate refund reference. Reconcile payment history before continuing.',
      };
    }
    seenRefundReferences.add(refundKey);

    const current = providerAmounts.get(refund.providerCode);
    if (!current) {
      return {
        reconciled: false,
        reason: 'Refund history does not have a matching settled payment provider. Reconcile payment history before continuing.',
      };
    }
    current.refundedMinor += refund.amountMinor;
  }

  const providers = [...providerAmounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([providerCode, value]): BookingSettlementProviderSummary => ({
      providerCode,
      grossSettledMinor: value.grossSettledMinor,
      refundedMinor: value.refundedMinor,
      netSettledMinor: value.grossSettledMinor - value.refundedMinor,
      sourceCount: value.sourceCount,
    }));
  const overRefundedProvider = providers.find((provider) => provider.refundedMinor > provider.grossSettledMinor);
  if (overRefundedProvider) {
    return {
      reconciled: false,
      reason: 'Refund history exceeds settled money for a payment provider. Reconcile payment history before continuing.',
    };
  }

  const grossSettledMinor = providers.reduce((total, provider) => total + provider.grossSettledMinor, 0n);
  const refundedMinor = providers.reduce((total, provider) => total + provider.refundedMinor, 0n);

  return {
    reconciled: true,
    currency: input.currency,
    grossSettledMinor,
    refundedMinor,
    netSettledMinor: grossSettledMinor - refundedMinor,
    sources: [...sources].sort((left, right) => {
      const providerOrder = left.providerCode.localeCompare(right.providerCode);
      if (providerOrder !== 0) return providerOrder;
      return left.providerReference.localeCompare(right.providerReference);
    }),
    providers,
  };
}
