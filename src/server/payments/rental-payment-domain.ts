import { createHash } from 'node:crypto';

import { deriveBookingSettlementSummary, type BookingSettlementTransaction } from './payment-settlement-domain.ts';

export type RentalPaymentState = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';

export type RentalPaymentSettlement = Readonly<
  | {
    reconciled: true;
    paymentState: RentalPaymentState;
    grossSettledMinor: bigint;
    refundedMinor: bigint;
    netSettledMinor: bigint;
    outstandingMinor: bigint;
    nextRefundableSourceMinor: bigint;
  }
  | { reconciled: false; reason: string }
>;

export function deriveRentalPaymentSettlement(input: Readonly<{
  bookingTotalMinor: bigint;
  currency: string;
  transactions: readonly BookingSettlementTransaction[];
}>): RentalPaymentSettlement {
  if (input.bookingTotalMinor <= 0n) {
    return { reconciled: false, reason: 'Rental booking total must be positive before payment settlement can be reconciled.' };
  }

  const successful = input.transactions.filter((transaction) => transaction.status === 'SUCCEEDED');
  for (const transaction of successful) {
    if (transaction.providerCode !== 'manual' || (transaction.kind !== 'OFFLINE_PAYMENT' && transaction.kind !== 'REFUND')) {
      return {
        reconciled: false,
        reason: 'Rental payment history contains successful settlement evidence outside the enabled manual/offline contract.',
      };
    }
  }

  const settlement = deriveBookingSettlementSummary({ currency: input.currency, transactions: input.transactions });
  if (!settlement.reconciled) return settlement;
  if (settlement.netSettledMinor < 0n || settlement.netSettledMinor > input.bookingTotalMinor) {
    return { reconciled: false, reason: 'Rental payment history does not reconcile to the authoritative booking total.' };
  }

  const outstandingMinor = input.bookingTotalMinor - settlement.netSettledMinor;
  const nextRefundableSourceMinor = settlement.sources.reduce(
    (largest, source) => source.remainingMinor > largest ? source.remainingMinor : largest,
    0n,
  );
  const paymentState: RentalPaymentState = settlement.grossSettledMinor === 0n
    ? 'UNPAID'
    : settlement.netSettledMinor === 0n
      ? 'REFUNDED'
      : settlement.netSettledMinor === input.bookingTotalMinor
        ? 'PAID'
        : settlement.refundedMinor === 0n
          ? 'PARTIALLY_PAID'
          : 'PARTIALLY_REFUNDED';

  return Object.freeze({
    reconciled: true as const,
    paymentState,
    grossSettledMinor: settlement.grossSettledMinor,
    refundedMinor: settlement.refundedMinor,
    netSettledMinor: settlement.netSettledMinor,
    outstandingMinor,
    nextRefundableSourceMinor,
  });
}

export function buildRentalPaymentIdempotencyKey(input: Readonly<{
  kind: 'manual-payment' | 'manual-refund';
  bookingId: string;
  reference: string;
}>) {
  const digest = createHash('sha256')
    .update(`${input.kind}\u0000${input.bookingId}\u0000${input.reference}`, 'utf8')
    .digest('hex');
  return `rental:${input.kind}:${digest.slice(0, 48)}`;
}

export function buildRentalPaymentRequestFingerprint(input: Readonly<{
  organizationId: string;
  bookingId: string;
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
      'rental-payment-request-v1',
      input.organizationId,
      input.bookingId,
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
