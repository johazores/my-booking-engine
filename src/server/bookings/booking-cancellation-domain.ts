import type { PaymentState } from './booking-domain.ts';

const cancellablePaymentStates: ReadonlySet<PaymentState> = new Set(['UNPAID', 'FAILED', 'REFUNDED']);

export function canCancelBookingWithPaymentState(paymentStatus: PaymentState) {
  return cancellablePaymentStates.has(paymentStatus);
}

export function bookingCancellationPaymentBlockReason(paymentStatus: PaymentState) {
  if (canCancelBookingWithPaymentState(paymentStatus)) return null;
  if (paymentStatus === 'AUTHORIZED') return 'Release or settle the active authorization before cancelling this booking.';
  return 'Complete the required refund before cancelling this booking.';
}
