import { deriveNextBookingRefundSource } from './payment-refund-allocation-domain.ts';
import { deriveBookingPaymentStatusFromNetSettlement, type ReconciledBookingPaymentStatus } from './payment-refund-state-domain.ts';
import { deriveBookingSettlementSummary, type BookingSettlementTransaction, type BookingSettlementSource } from './payment-settlement-domain.ts';

export type BookingRefundExecutionPlan = Readonly<
  | {
    planned: true;
    providerCode: 'manual' | 'stripe';
    sourceProviderReference: string;
    sourceKind: BookingSettlementSource['kind'];
    currency: string;
    amountMinor: bigint;
    sourceRefundableMinor: bigint;
    bookingRefundableMinor: bigint;
    refundableSourceCount: number;
    nextPaymentStatus: ReconciledBookingPaymentStatus;
  }
  | { planned: false; reason: string }
>;

export function deriveBookingRefundExecutionPlan(input: {
  bookingPaymentStatus: string;
  bookingTotalMinor: bigint;
  currency: string;
  transactions: readonly BookingSettlementTransaction[];
  expectedProviderCode?: 'manual' | 'stripe';
  requestedAmountMinor?: bigint | null;
}): BookingRefundExecutionPlan {
  const settlement = deriveBookingSettlementSummary({ currency: input.currency, transactions: input.transactions });
  if (!settlement.reconciled) return { planned: false, reason: settlement.reason };
  if (settlement.providers.length !== 1) {
    return { planned: false, reason: 'Multiple payment providers appear settled for this booking. Reconcile payment history before refunding.' };
  }

  const provider = settlement.providers[0];
  if (!provider || (provider.providerCode !== 'manual' && provider.providerCode !== 'stripe')) {
    return { planned: false, reason: 'No successful supported payment settlement is available to refund.' };
  }
  if (input.expectedProviderCode && provider.providerCode !== input.expectedProviderCode) {
    return { planned: false, reason: `This booking is settled through ${provider.providerCode}, not ${input.expectedProviderCode}.` };
  }

  const currentPaymentStatus = deriveBookingPaymentStatusFromNetSettlement({
    bookingTotalMinor: input.bookingTotalMinor,
    netSettledMinor: settlement.netSettledMinor,
  });
  if (!currentPaymentStatus.reconciled || currentPaymentStatus.paymentStatus !== input.bookingPaymentStatus) {
    return { planned: false, reason: 'Booking payment status is inconsistent with settled payment history. Reconcile payment history before refunding.' };
  }

  const allocation = deriveNextBookingRefundSource({ sources: settlement.sources });
  if (!allocation.allocated) return { planned: false, reason: allocation.reason };
  if (allocation.providerCode !== provider.providerCode || allocation.bookingRefundableMinor !== settlement.netSettledMinor) {
    return { planned: false, reason: 'Refund source allocation is inconsistent with settled payment history. Reconcile payment history before refunding.' };
  }

  const requestedAmountMinor = input.requestedAmountMinor ?? null;
  if (requestedAmountMinor !== null && requestedAmountMinor <= 0n) {
    return { planned: false, reason: 'Refund amount must be greater than zero.' };
  }
  const amountMinor = requestedAmountMinor ?? allocation.sourceRefundableMinor;
  if (amountMinor > allocation.sourceRefundableMinor) {
    return {
      planned: false,
      reason: 'Refund amount exceeds the remaining refundable balance of the next settlement source. Split the refund across settlement sources.',
    };
  }

  const nextPaymentStatus = deriveBookingPaymentStatusFromNetSettlement({
    bookingTotalMinor: input.bookingTotalMinor,
    netSettledMinor: settlement.netSettledMinor - amountMinor,
  });
  if (!nextPaymentStatus.reconciled) return { planned: false, reason: nextPaymentStatus.reason };

  return {
    planned: true,
    providerCode: provider.providerCode,
    sourceProviderReference: allocation.providerReference,
    sourceKind: allocation.sourceKind,
    currency: allocation.currency,
    amountMinor,
    sourceRefundableMinor: allocation.sourceRefundableMinor,
    bookingRefundableMinor: allocation.bookingRefundableMinor,
    refundableSourceCount: allocation.refundableSourceCount,
    nextPaymentStatus: nextPaymentStatus.paymentStatus,
  };
}
