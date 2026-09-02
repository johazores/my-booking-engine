export type BookingSettlementTransaction = Readonly<{
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  providerCode: string;
  providerReference: string;
  sourceProviderReference?: string | null;
  currency: string;
  amountMinor: bigint;
}>;

export type BookingSettlementSource = Readonly<{
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE';
  providerCode: string;
  providerReference: string;
  currency: string;
  amountMinor: bigint;
  refundedMinor: bigint;
  remainingMinor: bigint;
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

function transactionKey(providerCode: string, providerReference: string) {
  return `${providerCode}\u001f${providerReference}`;
}

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
  if (transaction.kind !== 'REFUND' && transaction.sourceProviderReference != null) {
    return 'Successful settlement history contains refund-source attribution on a non-refund transaction. Reconcile payment history before continuing.';
  }
  if (transaction.sourceProviderReference != null && !transaction.sourceProviderReference.trim()) {
    return 'Successful refund history contains an invalid settlement-source reference. Reconcile payment history before continuing.';
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
      .map((transaction) => transactionKey(transaction.providerCode, transaction.providerReference)),
  );
  const rawSources = successful
    .filter(isSuccessfulSettlementKind)
    .filter((transaction) => (
      transaction.kind !== 'AUTHORIZATION'
      || !successfulCaptures.has(transactionKey(transaction.providerCode, transaction.providerReference))
    ))
    .map((transaction) => ({
      kind: transaction.kind as BookingSettlementSource['kind'],
      providerCode: transaction.providerCode,
      providerReference: transaction.providerReference,
      currency: transaction.currency,
      amountMinor: transaction.amountMinor,
    }));

  const sourceAmounts = new Map<string, {
    kind: BookingSettlementSource['kind'];
    providerCode: string;
    providerReference: string;
    currency: string;
    amountMinor: bigint;
    refundedMinor: bigint;
  }>();
  for (const source of rawSources) {
    const key = transactionKey(source.providerCode, source.providerReference);
    if (sourceAmounts.has(key)) {
      return {
        reconciled: false,
        reason: 'Successful payment history contains a duplicate settlement reference. Reconcile payment history before continuing.',
      };
    }
    sourceAmounts.set(key, { ...source, refundedMinor: 0n });
  }

  const sourcesByProvider = new Map<string, string[]>();
  for (const [key, source] of sourceAmounts) {
    const keys = sourcesByProvider.get(source.providerCode) ?? [];
    keys.push(key);
    sourcesByProvider.set(source.providerCode, keys);
  }

  const successfulRefunds = successful.filter((transaction) => transaction.kind === 'REFUND');
  const seenRefundReferences = new Set<string>();
  for (const refund of successfulRefunds) {
    const refundKey = transactionKey(refund.providerCode, refund.providerReference);
    if (seenRefundReferences.has(refundKey)) {
      return {
        reconciled: false,
        reason: 'Successful payment history contains a duplicate refund reference. Reconcile payment history before continuing.',
      };
    }
    seenRefundReferences.add(refundKey);

    const providerSourceKeys = sourcesByProvider.get(refund.providerCode) ?? [];
    if (providerSourceKeys.length === 0) {
      return {
        reconciled: false,
        reason: 'Refund history does not have a matching settled payment provider. Reconcile payment history before continuing.',
      };
    }

    let sourceKey: string;
    if (refund.sourceProviderReference != null) {
      sourceKey = transactionKey(refund.providerCode, refund.sourceProviderReference);
      if (!sourceAmounts.has(sourceKey)) {
        return {
          reconciled: false,
          reason: 'Refund history references a settlement source that is not present in successful payment history. Reconcile payment history before continuing.',
        };
      }
    } else if (providerSourceKeys.length === 1) {
      sourceKey = providerSourceKeys[0]!;
    } else {
      return {
        reconciled: false,
        reason: 'Refund history is missing settlement-source attribution for a booking with multiple payment sources. Reconcile payment history before continuing.',
      };
    }

    const source = sourceAmounts.get(sourceKey)!;
    const refundedMinor = source.refundedMinor + refund.amountMinor;
    if (refundedMinor > source.amountMinor) {
      return {
        reconciled: false,
        reason: 'Refund history exceeds settled money for its payment source. Reconcile payment history before continuing.',
      };
    }
    source.refundedMinor = refundedMinor;
  }

  const sources = [...sourceAmounts.values()]
    .map((source): BookingSettlementSource => ({
      ...source,
      remainingMinor: source.amountMinor - source.refundedMinor,
    }))
    .sort((left, right) => {
      const providerOrder = left.providerCode.localeCompare(right.providerCode);
      if (providerOrder !== 0) return providerOrder;
      return left.providerReference.localeCompare(right.providerReference);
    });

  const providerAmounts = new Map<string, { grossSettledMinor: bigint; refundedMinor: bigint; sourceCount: number }>();
  for (const source of sources) {
    const current = providerAmounts.get(source.providerCode) ?? {
      grossSettledMinor: 0n,
      refundedMinor: 0n,
      sourceCount: 0,
    };
    current.grossSettledMinor += source.amountMinor;
    current.refundedMinor += source.refundedMinor;
    current.sourceCount += 1;
    providerAmounts.set(source.providerCode, current);
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

  const grossSettledMinor = providers.reduce((total, provider) => total + provider.grossSettledMinor, 0n);
  const refundedMinor = providers.reduce((total, provider) => total + provider.refundedMinor, 0n);

  return {
    reconciled: true,
    currency: input.currency,
    grossSettledMinor,
    refundedMinor,
    netSettledMinor: grossSettledMinor - refundedMinor,
    sources,
    providers,
  };
}
