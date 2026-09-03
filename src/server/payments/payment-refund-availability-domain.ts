import { deriveBookingRefundExecutionPlan } from './payment-refund-execution-domain.ts';
import type { BookingSettlementTransaction } from './payment-settlement-domain.ts';

export type BookingRefundTransaction = BookingSettlementTransaction;

export type BookingRefundAvailability = Readonly<
  | {
    available: true;
    providerCode: 'manual' | 'stripe';
    currency: string;
    refundableMinor: bigint;
    bookingRefundableMinor: bigint;
    refundableSourceCount: number;
    sourceReference: string | null;
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

  const plan = deriveBookingRefundExecutionPlan({
    bookingPaymentStatus: input.paymentStatus,
    bookingTotalMinor: input.totalMinor,
    currency: input.currency,
    transactions: input.transactions,
  });
  if (!plan.planned) return { available: false, reason: plan.reason };

  return {
    available: true,
    providerCode: plan.providerCode,
    currency: input.currency,
    refundableMinor: plan.amountMinor,
    bookingRefundableMinor: plan.bookingRefundableMinor,
    refundableSourceCount: plan.refundableSourceCount,
    sourceReference: plan.providerCode === 'manual' ? plan.sourceProviderReference : null,
    requiresReference: plan.providerCode === 'manual',
  };
}
