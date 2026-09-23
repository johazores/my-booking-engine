export type StripeRefundTransactionStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
export type StripeRefundProviderStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export type StripeRefundLifecycleDecision = Readonly<
  | {
      action: 'MUTATE';
      nextStatus: StripeRefundProviderStatus;
      processingNote: 'refund-state-reconciled';
    }
  | {
      action: 'KEEP';
      nextStatus: StripeRefundTransactionStatus;
      processingNote: 'refund-state-unchanged';
    }
>;

export function decideStripeRefundLifecycleMutation(input: {
  currentStatus: StripeRefundTransactionStatus;
  providerStatus: StripeRefundProviderStatus;
}): StripeRefundLifecycleDecision {
  if (input.currentStatus === input.providerStatus) {
    return Object.freeze({
      action: 'KEEP',
      nextStatus: input.currentStatus,
      processingNote: 'refund-state-unchanged',
    });
  }
  return Object.freeze({
    action: 'MUTATE',
    nextStatus: input.providerStatus,
    processingNote: 'refund-state-reconciled',
  });
}

export function bookingPaymentStatusForRefundLifecycle(input: {
  refundStatus: StripeRefundTransactionStatus;
  baselinePaymentStatus: 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
  successfulRefundPaymentStatus: 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
}) {
  return input.refundStatus === 'SUCCEEDED'
    ? input.successfulRefundPaymentStatus
    : input.baselinePaymentStatus;
}
