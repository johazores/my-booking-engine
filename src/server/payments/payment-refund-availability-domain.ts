import { deriveNextBookingRefundSource } from './payment-refund-allocation-domain.ts';
import { deriveBookingPaymentStatusFromNetSettlement } from './payment-refund-state-domain.ts';
import {
  deriveBookingSettlementSummary,
  type BookingSettlementTransaction,
} from './payment-settlement-domain.ts';

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

  const settlement = deriveBookingSettlementSummary({
    currency: input.currency,
    transactions: input.transactions,
  });
  if (!settlement.reconciled) {
    return { available: false, reason: settlement.reason };
  }
  if (settlement.providers.length > 1) {
    return {
      available: false,
      reason: 'Multiple payment providers appear settled for this booking. Reconcile payment history before refunding.',
    };
  }
  const provider = settlement.providers[0];
  if (!provider || (provider.providerCode !== 'manual' && provider.providerCode !== 'stripe')) {
    return { available: false, reason: 'No successful supported payment settlement is available to refund.' };
  }
  const derivedPaymentStatus = deriveBookingPaymentStatusFromNetSettlement({
    bookingTotalMinor: input.totalMinor,
    netSettledMinor: settlement.netSettledMinor,
  });
  if (!derivedPaymentStatus.reconciled || derivedPaymentStatus.paymentStatus !== input.paymentStatus) {
    return { available: false, reason: 'Booking payment status is inconsistent with settled payment history. Reconcile payment history before refunding.' };
  }
  if (settlement.netSettledMinor <= 0n) {
    return { available: false, reason: 'This booking payment has no remaining refundable balance.' };
  }

  const allocation = deriveNextBookingRefundSource({ sources: settlement.sources });
  if (!allocation.allocated) {
    return { available: false, reason: allocation.reason };
  }
  if (allocation.providerCode !== provider.providerCode || allocation.bookingRefundableMinor !== settlement.netSettledMinor) {
    return { available: false, reason: 'Refund source allocation is inconsistent with settled payment history. Reconcile payment history before refunding.' };
  }
  if (settlement.sources.length !== 1) {
    return {
      available: false,
      reason: 'This booking has multiple settlement sources. Deterministic allocation is defined, but source-aware provider execution must be completed before another general refund can be started.',
    };
  }

  return {
    available: true,
    providerCode: provider.providerCode,
    currency: input.currency,
    refundableMinor: allocation.sourceRefundableMinor,
    requiresReference: provider.providerCode === 'manual',
  };
}
