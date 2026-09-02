import { deriveBookingRefundExecutionPlan } from './payment-refund-execution-domain.ts';
import type { BookingSettlementTransaction } from './payment-settlement-domain.ts';

export type BookingRefundTransaction = BookingSettlementTransaction;

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

  if (plan.providerCode === 'stripe' && plan.refundableSourceCount > 1) {
    return {
      available: false,
      reason: 'This booking has multiple Stripe settlement sources. Deterministic allocation is defined, but source-aware Stripe execution and recovery must be completed before another general refund can be started.',
    };
  }

  return {
    available: true,
    providerCode: plan.providerCode,
    currency: input.currency,
    refundableMinor: plan.amountMinor,
    requiresReference: plan.providerCode === 'manual',
  };
}
