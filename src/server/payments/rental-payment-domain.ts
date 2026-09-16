import { createHash } from 'node:crypto';

import { deriveBookingSettlementSummary, type BookingSettlementTransaction } from './payment-settlement-domain.ts';

export type RentalPaymentState = 'UNPAID' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';

export type RentalPaymentSettlement = Readonly<
  | {
    reconciled: true;
    paymentState: RentalPaymentState;
    grossSettledMinor: bigint;
    refundedMinor: bigint;
    netSettledMinor: bigint;
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
    if (transaction.kind === 'OFFLINE_PAYMENT' && transaction.amountMinor !== input.bookingTotalMinor) {
      return {
        reconciled: false,
        reason: 'Rental offline payment history does not match the full authoritative booking total.',
      };
    }
  }

  const settlement = deriveBookingSettlementSummary({ currency: input.currency, transactions: input.transactions });
  if (!settlement.reconciled) return settlement;
  if (settlement.grossSettledMinor !== 0n && settlement.grossSettledMinor !== input.bookingTotalMinor) {
    return {
      reconciled: false,
      reason: 'Rental payment history contains more than the enabled full-value settlement contract.',
    };
  }
  if (settlement.netSettledMinor < 0n || settlement.netSettledMinor > input.bookingTotalMinor) {
    return { reconciled: false, reason: 'Rental payment history does not reconcile to the authoritative booking total.' };
  }

  const paymentState: RentalPaymentState = settlement.grossSettledMinor === 0n
    ? 'UNPAID'
    : settlement.refundedMinor === 0n
      ? 'PAID'
      : settlement.netSettledMinor === 0n
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED';

  return Object.freeze({
    reconciled: true as const,
    paymentState,
    grossSettledMinor: settlement.grossSettledMinor,
    refundedMinor: settlement.refundedMinor,
    netSettledMinor: settlement.netSettledMinor,
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
