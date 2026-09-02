export type PublicStripePaymentRecoveryState = 'PAYMENT_REQUIRED' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'EXPIRED';

export function decidePublicStripePaymentRecovery(input: {
  bookingStatus: string;
  bookingPaymentStatus: string;
  pendingAllocationProtected: boolean;
  latestPaymentStatus: string | null;
  hasOpenCheckout: boolean;
}) {
  let state: PublicStripePaymentRecoveryState;
  if (input.bookingStatus === 'CANCELLED') state = 'CANCELLED';
  else if (['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(input.bookingPaymentStatus)) state = 'PAID';
  else if (!input.pendingAllocationProtected) state = 'EXPIRED';
  else if (input.latestPaymentStatus === 'PENDING' || input.latestPaymentStatus === 'AMBIGUOUS' || input.bookingPaymentStatus === 'AUTHORIZED') state = 'PROCESSING';
  else if (input.latestPaymentStatus === 'FAILED' || input.bookingPaymentStatus === 'FAILED') state = 'FAILED';
  else state = 'PAYMENT_REQUIRED';

  const canResumeCheckout = state === 'PROCESSING'
    && input.hasOpenCheckout
    && input.latestPaymentStatus === 'PENDING'
    && input.bookingPaymentStatus !== 'AUTHORIZED';
  const canContinuePayment = state === 'PAYMENT_REQUIRED'
    || state === 'FAILED'
    || (state === 'PROCESSING' && input.latestPaymentStatus === 'PENDING' && input.bookingPaymentStatus !== 'AUTHORIZED');

  return Object.freeze({ state, canResumeCheckout, canContinuePayment });
}
