export type BookingRefundTransaction = Readonly<{
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  providerCode: string;
  providerReference: string;
  currency: string;
  amountMinor: bigint;
}>;

export type BookingRefundAvailability = Readonly<
  | {
    available: true;
    providerCode: 'manual' | 'stripe';
    currency: string;
    refundableMinor: bigint;
    requiresReference: boolean;
  }
  | {
    available: false;
    reason: string;
  }
>;

type BookingRefundAvailabilityInput = Readonly<{
  status: string;
  paymentStatus: string;
  currency: string;
  totalMinor: bigint;
  transactions: readonly BookingRefundTransaction[];
}>;

function successfulExternalStripeSource(transactions: readonly BookingRefundTransaction[]) {
  const eligible = transactions.filter((transaction) => (
    transaction.providerCode === 'stripe'
    && transaction.status === 'SUCCEEDED'
    && !transaction.providerReference.startsWith('sf_claim_')
  ));
  const captures = eligible.filter((transaction) => transaction.kind === 'CAPTURE');
  if (captures.length > 1) return { source: null, ambiguous: true } as const;
  if (captures.length === 1) return { source: captures[0], ambiguous: false } as const;
  const authorizations = eligible.filter((transaction) => transaction.kind === 'AUTHORIZATION');
  if (authorizations.length > 1) return { source: null, ambiguous: true } as const;
  return { source: authorizations[0] ?? null, ambiguous: false } as const;
}

export function deriveBookingRefundAvailability(input: BookingRefundAvailabilityInput): BookingRefundAvailability {
  if (input.status !== 'CONFIRMED') {
    return { available: false, reason: 'Only confirmed bookings can be refunded.' };
  }
  if (input.paymentStatus === 'REFUNDED') {
    return { available: false, reason: 'This booking payment has already been fully refunded.' };
  }
  if (input.paymentStatus !== 'PAID' && input.paymentStatus !== 'PARTIALLY_REFUNDED') {
    return { available: false, reason: `Booking payment state ${input.paymentStatus.toLowerCase().replaceAll('_', ' ')} does not accept a refund.` };
  }
  if (input.transactions.some((transaction) => transaction.kind === 'REFUND' && (transaction.status === 'PENDING' || transaction.status === 'AMBIGUOUS'))) {
    return { available: false, reason: 'An earlier refund is still unresolved. Reconcile it before starting another refund.' };
  }

  const manualSources = input.transactions.filter((transaction) => (
    transaction.providerCode === 'manual'
    && transaction.kind === 'OFFLINE_PAYMENT'
    && transaction.status === 'SUCCEEDED'
  ));
  if (manualSources.length > 1) {
    return { available: false, reason: 'Multiple successful manual payment sources were found. Reconcile payment history before refunding.' };
  }

  const stripe = successfulExternalStripeSource(input.transactions);
  if (stripe.ambiguous) {
    return { available: false, reason: 'Multiple successful Stripe settlement sources were found. Reconcile payment history before refunding.' };
  }
  if (manualSources.length === 1 && stripe.source) {
    return { available: false, reason: 'Multiple payment providers appear settled for this booking. Reconcile payment history before refunding.' };
  }

  const source = manualSources[0] ?? stripe.source;
  const providerCode = manualSources[0] ? 'manual' as const : stripe.source ? 'stripe' as const : null;
  if (!source || !providerCode) {
    return { available: false, reason: 'No successful supported payment settlement is available to refund.' };
  }
  if (source.currency !== input.currency || source.amountMinor !== input.totalMinor) {
    return { available: false, reason: 'The settled payment does not match the authoritative booking total. Reconcile payment history before refunding.' };
  }

  const refundedMinor = input.transactions.reduce((total, transaction) => (
    transaction.kind === 'REFUND'
    && transaction.status === 'SUCCEEDED'
    && transaction.providerCode === providerCode
    && transaction.currency === input.currency
      ? total + transaction.amountMinor
      : total
  ), 0n);
  if (refundedMinor > source.amountMinor) {
    return { available: false, reason: 'Refund history is inconsistent with the settled payment. Reconcile payment history before refunding.' };
  }
  const refundableMinor = source.amountMinor - refundedMinor;
  if (refundableMinor <= 0n) {
    return { available: false, reason: 'This booking payment has no remaining refundable balance.' };
  }

  return {
    available: true,
    providerCode,
    currency: input.currency,
    refundableMinor,
    requiresReference: providerCode === 'manual',
  };
}
