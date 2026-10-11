import { deriveBookingSettlementSummary, type BookingSettlementTransaction } from './payment-settlement-domain.ts';

export type ReconciledBookingPaymentStatus = 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';

export type BookingPaymentStatusFromSettlement = Readonly<
  | { reconciled: true; paymentStatus: ReconciledBookingPaymentStatus }
  | { reconciled: false; reason: string }
>;

export function deriveBookingPaymentStatusFromNetSettlement(input: {
  bookingTotalMinor: bigint;
  netSettledMinor: bigint;
}): BookingPaymentStatusFromSettlement {
  if (typeof input.bookingTotalMinor !== 'bigint' || input.bookingTotalMinor <= 0n) {
    return { reconciled: false, reason: 'Booking total must be positive before payment refund state can be reconciled.' };
  }
  if (typeof input.netSettledMinor !== 'bigint' || input.netSettledMinor < 0n || input.netSettledMinor > input.bookingTotalMinor) {
    return {
      reconciled: false,
      reason: 'Net settled money is inconsistent with the authoritative booking total. Reconcile payment history before continuing.',
    };
  }
  if (input.netSettledMinor === 0n) return { reconciled: true, paymentStatus: 'REFUNDED' };
  if (input.netSettledMinor === input.bookingTotalMinor) return { reconciled: true, paymentStatus: 'PAID' };
  return { reconciled: true, paymentStatus: 'PARTIALLY_REFUNDED' };
}

export function deriveBookingPaymentStatusFromSettlementTransactions(input: {
  bookingTotalMinor: bigint;
  currency: string;
  transactions: readonly BookingSettlementTransaction[];
}): BookingPaymentStatusFromSettlement {
  const settlement = deriveBookingSettlementSummary({
    currency: input.currency,
    transactions: input.transactions,
  });
  if (settlement.reconciled === false) return { reconciled: false, reason: settlement.reason };
  // A missing/failed-only ledger has zero net, but it is not evidence of a completed refund.
  if (settlement.grossSettledMinor <= 0n) {
    return { reconciled: false, reason: 'No successful received payment exists to establish a refunded booking state.' };
  }
  return deriveBookingPaymentStatusFromNetSettlement({
    bookingTotalMinor: input.bookingTotalMinor,
    netSettledMinor: settlement.netSettledMinor,
  });
}
