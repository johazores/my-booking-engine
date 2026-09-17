import { createHash } from 'node:crypto';

export type RentalDamageSettlementState = 'UNPAID' | 'PAID' | 'REFUNDED';

export type RentalDamageSettlementTransactionEvidence = Readonly<{
  kind: 'OFFLINE_PAYMENT' | 'REFUND';
  status: 'SUCCEEDED';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}>;

export type RentalDamageSettlement = Readonly<
  | {
    reconciled: true;
    state: RentalDamageSettlementState;
    collectedMinor: bigint;
    refundedMinor: bigint;
    netCollectedMinor: bigint;
    sourceProviderReference: string | null;
  }
  | { reconciled: false; reason: string }
>;

export function deriveRentalDamageSettlement(input: Readonly<{
  liableAmountMinor: bigint;
  currency: string;
  transactions: readonly RentalDamageSettlementTransactionEvidence[];
}>): RentalDamageSettlement {
  if (input.liableAmountMinor <= 0n) {
    return { reconciled: false, reason: 'Customer damage liability must be positive before settlement can be reconciled.' };
  }

  const payments = input.transactions.filter((row) => row.kind === 'OFFLINE_PAYMENT');
  const refunds = input.transactions.filter((row) => row.kind === 'REFUND');
  if (payments.length > 1 || refunds.length > 1 || input.transactions.length !== payments.length + refunds.length) {
    return { reconciled: false, reason: 'Damage settlement history exceeds the enabled one-payment/one-refund contract.' };
  }

  for (const row of input.transactions) {
    if (
      row.status !== 'SUCCEEDED'
      || row.providerCode !== 'manual'
      || row.currency !== input.currency
      || row.amountMinor !== input.liableAmountMinor
    ) {
      return { reconciled: false, reason: 'Damage settlement history does not match the enabled full-value manual/offline contract.' };
    }
  }

  const payment = payments[0] ?? null;
  const refund = refunds[0] ?? null;
  if (!payment) {
    if (refund) return { reconciled: false, reason: 'Damage settlement refund has no retained payment source.' };
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
    return { reconciled: false, reason: 'Damage settlement payment cannot point at a refund source.' };
  }
  if (!refund) {
    return Object.freeze({
      reconciled: true as const,
      state: 'PAID' as const,
      collectedMinor: input.liableAmountMinor,
      refundedMinor: 0n,
      netCollectedMinor: input.liableAmountMinor,
      sourceProviderReference: payment.providerReference,
    });
  }
  if (
    refund.sourceProviderReference !== payment.providerReference
    || refund.providerReference === payment.providerReference
    || refund.createdAt.getTime() < payment.createdAt.getTime()
  ) {
    return { reconciled: false, reason: 'Damage settlement refund does not reconcile to the retained payment source and chronology.' };
  }
  return Object.freeze({
    reconciled: true as const,
    state: 'REFUNDED' as const,
    collectedMinor: input.liableAmountMinor,
    refundedMinor: input.liableAmountMinor,
    netCollectedMinor: 0n,
    sourceProviderReference: payment.providerReference,
  });
}

export function buildRentalDamageSettlementIdempotencyKey(input: Readonly<{
  kind: 'manual-payment' | 'manual-refund';
  liabilityDecisionId: string;
  reference: string;
}>) {
  const digest = createHash('sha256')
    .update(`${input.kind}\u0000${input.liabilityDecisionId}\u0000${input.reference}`, 'utf8')
    .digest('hex');
  return `rental-damage:${input.kind}:${digest.slice(0, 48)}`;
}

export function buildRentalDamageSettlementRequestFingerprint(input: Readonly<{
  organizationId: string;
  bookingId: string;
  damageCaseId: string;
  liabilityDecisionId: string;
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
      'rental-damage-settlement-request-v1',
      input.organizationId,
      input.bookingId,
      input.damageCaseId,
      input.liabilityDecisionId,
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
