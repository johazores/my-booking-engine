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

  const settlement = deriveBookingSettlementSummary({ currency: input.currency, transactions: input.transactions });
  if (!settlement.reconciled) return settlement;
  if (settlement.netSettledMinor < 0n || settlement.netSettledMinor > input.bookingTotalMinor) {
    return { reconciled: false, reason: 'Rental payment history does not reconcile to the authoritative booking total.' };
  }

  const paymentState: RentalPaymentState = settlement.grossSettledMinor === 0n
    ? 'UNPAID'
    : settlement.netSettledMinor === 0n
      ? 'REFUNDED'
      : settlement.netSettledMinor === input.bookingTotalMinor
        ? 'PAID'
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
