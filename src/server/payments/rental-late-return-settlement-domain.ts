import { createHash } from 'node:crypto';

export type RentalLateReturnSettlementState = 'UNPAID' | 'PAID' | 'REFUNDED';

export type RentalLateReturnSettlementTransactionEvidence = Readonly<{
  kind: 'OFFLINE_PAYMENT' | 'REFUND';
  status: 'SUCCEEDED';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}>;

export type RentalLateReturnSettlement = Readonly<
  | {
    reconciled: true;
    state: RentalLateReturnSettlementState;
    collectedMinor: bigint;
    refundedMinor: bigint;
    netCollectedMinor: bigint;
    sourceProviderReference: string | null;
  }
  | { reconciled: false; reason: string }
>;

export function deriveRentalLateReturnSettlement(input: Readonly<{
  feeMinor: bigint;
  currency: string;
  transactions: readonly RentalLateReturnSettlementTransactionEvidence[];
}>): RentalLateReturnSettlement {
  if (input.feeMinor <= 0n) {
    return { reconciled: false, reason: 'Late-return fee authority must be positive before settlement can be reconciled.' };
  }

  const payments = input.transactions.filter((row) => row.kind === 'OFFLINE_PAYMENT');
  const refunds = input.transactions.filter((row) => row.kind === 'REFUND');
  if (payments.length > 1 || refunds.length > 1 || input.transactions.length !== payments.length + refunds.length) {
    return { reconciled: false, reason: 'Late-return settlement history exceeds the enabled one-payment/one-refund contract.' };
  }

  for (const row of input.transactions) {
    if (
      row.status !== 'SUCCEEDED'
      || row.providerCode !== 'manual'
      || row.currency !== input.currency
      || row.amountMinor !== input.feeMinor
    ) {
      return { reconciled: false, reason: 'Late-return settlement history does not match the enabled full-value manual/offline contract.' };
    }
  }

  const payment = payments[0] ?? null;
  const refund = refunds[0] ?? null;
  if (!payment) {
    if (refund) return { reconciled: false, reason: 'Late-return refund has no retained payment source.' };
    return Object.freeze({
      reconciled: true as const,
      state: 'UNPAID' as const,
      collectedMinor: 0n,
      refundedMinor: 0n,
      netCollectedMinor: 0n,
      sourceProviderReference: null,
    });
  }

  if (payment.sourceProviderReference !== null) {
    return { reconciled: false, reason: 'Late-return payment cannot point at a refund source.' };
  }
  if (!refund) {
    return Object.freeze({
      reconciled: true as const,
      state: 'PAID' as const,
      collectedMinor: input.feeMinor,
      refundedMinor: 0n,
      netCollectedMinor: input.feeMinor,
      sourceProviderReference: payment.providerReference,
    });
  }

  if (
    refund.sourceProviderReference !== payment.providerReference
    || refund.providerReference === payment.providerReference
    || refund.createdAt.getTime() < payment.createdAt.getTime()
  ) {
    return { reconciled: false, reason: 'Late-return refund does not reconcile to the retained payment source and chronology.' };
  }

  return Object.freeze({
    reconciled: true as const,
    state: 'REFUNDED' as const,
    collectedMinor: input.feeMinor,
    refundedMinor: input.feeMinor,
    netCollectedMinor: 0n,
    sourceProviderReference: payment.providerReference,
  });
}

export function buildRentalLateReturnSettlementIdempotencyKey(input: Readonly<{
  kind: 'manual-payment' | 'manual-refund';
  assessmentId: string;
  reference: string;
}>) {
  const digest = createHash('sha256')
    .update(`${input.kind}\u0000${input.assessmentId}\u0000${input.reference}`, 'utf8')
    .digest('hex');
  return `rental-late-return:${input.kind}:${digest.slice(0, 48)}`;
}

export function buildRentalLateReturnSettlementRequestFingerprint(input: Readonly<{
  organizationId: string;
  bookingId: string;
  assessmentId: string;
  idempotencyKey: string;
  kind: 'OFFLINE_PAYMENT' | 'REFUND';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>) {
  return createHash('sha256')
    .update([
      'rental-late-return-settlement-request-v1',
      input.organizationId,
      input.bookingId,
      input.assessmentId,
      input.idempotencyKey,
      input.kind,
      input.providerCode,
      input.providerReference,
      input.sourceProviderReference ?? '',
      input.currency,
      input.amountMinor.toString(),
    ].join('\u001f'), 'utf8')
    .digest('hex');
}
