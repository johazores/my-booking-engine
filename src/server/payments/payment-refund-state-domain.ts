export type ReconciledBookingPaymentStatus = 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';

export type BookingPaymentStatusFromSettlement = Readonly<
  | { reconciled: true; paymentStatus: ReconciledBookingPaymentStatus }
  | { reconciled: false; reason: string }
>;

export function deriveBookingPaymentStatusFromNetSettlement(input: {
  bookingTotalMinor: bigint;
  netSettledMinor: bigint;
}): BookingPaymentStatusFromSettlement {
  if (input.bookingTotalMinor <= 0n) {
    return { reconciled: false, reason: 'Booking total must be positive before payment refund state can be reconciled.' };
  }
  if (input.netSettledMinor < 0n || input.netSettledMinor > input.bookingTotalMinor) {
    return {
      reconciled: false,
      reason: 'Net settled money is inconsistent with the authoritative booking total. Reconcile payment history before continuing.',
    };
  }
  if (input.netSettledMinor === 0n) return { reconciled: true, paymentStatus: 'REFUNDED' };
  if (input.netSettledMinor === input.bookingTotalMinor) return { reconciled: true, paymentStatus: 'PAID' };
  return { reconciled: true, paymentStatus: 'PARTIALLY_REFUNDED' };
}
