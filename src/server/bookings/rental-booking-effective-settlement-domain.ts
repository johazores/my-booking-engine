import type { BookingSettlementTransaction } from '../payments/payment-settlement-domain.ts';
import { deriveRentalPaymentSettlement } from '../payments/rental-payment-domain.ts';
import {
  deriveRentalBookingCommercialAmendmentSettlementState,
  type RentalBookingCommercialAmendmentSettlementRow,
} from './rental-booking-commercial-amendment-settlement-domain.ts';

export type AppliedRentalBookingCommercialAmendmentSettlementEvidence = Readonly<{
  id: string;
  direction: 'ADDITIONAL_CHARGE' | 'REFUND';
  currency: string;
  beforeTotalMinor: bigint;
  afterTotalMinor: bigint;
  deltaMinor: bigint;
  settlementRows: readonly RentalBookingCommercialAmendmentSettlementRow[];
}>;

export type RentalBookingEffectiveSettlement = Readonly<
  | {
      reconciled: true;
      currency: string;
      originalBookingTotalMinor: bigint;
      effectiveAcceptedTotalMinor: bigint;
      originalBookingNetSettledMinor: bigint;
      amendmentNetEffectMinor: bigint;
      currentNetSettledMinor: bigint;
      cancellationRefundRemainingMinor: bigint;
      bookingPriceRefundRemainingMinor: bigint;
      amendmentChargeRefundRemainingMinor: bigint;
      fullyFunded: boolean;
      fullyRefunded: boolean;
      appliedAmendment: null | Readonly<{
        id: string;
        direction: 'ADDITIONAL_CHARGE' | 'REFUND';
        deltaMinor: bigint;
      }>;
    }
  | {
      reconciled: false;
      reason: string;
    }
>;

function conflict(reason: string): RentalBookingEffectiveSettlement {
  return Object.freeze({ reconciled: false as const, reason });
}

function summarize(input: Readonly<{
  currency: string;
  originalBookingTotalMinor: bigint;
  effectiveAcceptedTotalMinor: bigint;
  originalBookingNetSettledMinor: bigint;
  amendmentNetEffectMinor: bigint;
  currentNetSettledMinor: bigint;
  bookingPriceRefundRemainingMinor: bigint;
  amendmentChargeRefundRemainingMinor: bigint;
  appliedAmendment: null | Readonly<{ id: string; direction: 'ADDITIONAL_CHARGE' | 'REFUND'; deltaMinor: bigint }>;
}>): RentalBookingEffectiveSettlement {
  if (input.currentNetSettledMinor < 0n || input.currentNetSettledMinor > input.effectiveAcceptedTotalMinor) {
    return conflict('Effective rental settlement falls outside the accepted commercial total.');
  }
  if (input.bookingPriceRefundRemainingMinor < 0n || input.amendmentChargeRefundRemainingMinor < 0n) {
    return conflict('Effective rental settlement contains an invalid negative refund remainder.');
  }
  if (
    input.bookingPriceRefundRemainingMinor + input.amendmentChargeRefundRemainingMinor
    !== input.currentNetSettledMinor
  ) {
    return conflict('Effective rental refund decomposition does not reconcile to current settled money.');
  }

  return Object.freeze({
    reconciled: true as const,
    currency: input.currency,
    originalBookingTotalMinor: input.originalBookingTotalMinor,
    effectiveAcceptedTotalMinor: input.effectiveAcceptedTotalMinor,
    originalBookingNetSettledMinor: input.originalBookingNetSettledMinor,
    amendmentNetEffectMinor: input.amendmentNetEffectMinor,
    currentNetSettledMinor: input.currentNetSettledMinor,
    cancellationRefundRemainingMinor: input.currentNetSettledMinor,
    bookingPriceRefundRemainingMinor: input.bookingPriceRefundRemainingMinor,
    amendmentChargeRefundRemainingMinor: input.amendmentChargeRefundRemainingMinor,
    fullyFunded: input.currentNetSettledMinor === input.effectiveAcceptedTotalMinor,
    fullyRefunded: input.currentNetSettledMinor === 0n,
    appliedAmendment: input.appliedAmendment,
  });
}

export function deriveRentalBookingEffectiveSettlement(input: Readonly<{
  originalBookingTotalMinor: bigint;
  currency: string;
  originalTransactions: readonly BookingSettlementTransaction[];
  appliedAmendment?: AppliedRentalBookingCommercialAmendmentSettlementEvidence | null;
}>): RentalBookingEffectiveSettlement {
  if (input.originalBookingTotalMinor <= 0n) {
    return conflict('Rental booking total must remain positive for effective settlement reconciliation.');
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    return conflict('Rental booking currency is invalid for effective settlement reconciliation.');
  }

  const originalSettlement = deriveRentalPaymentSettlement({
    bookingTotalMinor: input.originalBookingTotalMinor,
    currency: input.currency,
    transactions: input.originalTransactions,
  });
  if (!originalSettlement.reconciled) {
    return conflict(`Original rental booking-price settlement is unreconciled. ${originalSettlement.reason}`);
  }

  const amendment = input.appliedAmendment ?? null;
  if (!amendment) {
    return summarize({
      currency: input.currency,
      originalBookingTotalMinor: input.originalBookingTotalMinor,
      effectiveAcceptedTotalMinor: input.originalBookingTotalMinor,
      originalBookingNetSettledMinor: originalSettlement.netSettledMinor,
      amendmentNetEffectMinor: 0n,
      currentNetSettledMinor: originalSettlement.netSettledMinor,
      bookingPriceRefundRemainingMinor: originalSettlement.netSettledMinor,
      amendmentChargeRefundRemainingMinor: 0n,
      appliedAmendment: null,
    });
  }

  if (!amendment.id.trim()) return conflict('Applied rental commercial amendment identity is missing.');
  if (amendment.currency !== input.currency) {
    return conflict('Applied rental commercial amendment currency differs from the booking currency.');
  }
  if (amendment.beforeTotalMinor !== input.originalBookingTotalMinor) {
    return conflict('Applied rental commercial amendment source total does not match the immutable booking total.');
  }
  if (amendment.afterTotalMinor <= 0n || amendment.deltaMinor <= 0n) {
    return conflict('Applied rental commercial amendment money is invalid.');
  }
  if (
    amendment.direction === 'ADDITIONAL_CHARGE'
      ? amendment.beforeTotalMinor + amendment.deltaMinor !== amendment.afterTotalMinor
      : amendment.afterTotalMinor + amendment.deltaMinor !== amendment.beforeTotalMinor
  ) {
    return conflict('Applied rental commercial amendment arithmetic does not reconcile.');
  }

  const amendmentSettlement = deriveRentalBookingCommercialAmendmentSettlementState({
    direction: amendment.direction,
    currency: amendment.currency,
    deltaMinor: amendment.deltaMinor,
    rows: amendment.settlementRows,
  });
  if (amendmentSettlement.state !== 'SETTLED') {
    const reason = amendmentSettlement.state === 'CONFLICT'
      ? amendmentSettlement.reason
      : `Applied rental commercial amendment settlement is ${amendmentSettlement.state.toLowerCase()} instead of settled.`;
    return conflict(reason);
  }

  if (amendment.direction === 'ADDITIONAL_CHARGE') {
    const currentNetSettledMinor = originalSettlement.netSettledMinor + amendment.deltaMinor;
    return summarize({
      currency: input.currency,
      originalBookingTotalMinor: input.originalBookingTotalMinor,
      effectiveAcceptedTotalMinor: amendment.afterTotalMinor,
      originalBookingNetSettledMinor: originalSettlement.netSettledMinor,
      amendmentNetEffectMinor: amendment.deltaMinor,
      currentNetSettledMinor,
      bookingPriceRefundRemainingMinor: originalSettlement.netSettledMinor,
      amendmentChargeRefundRemainingMinor: amendment.deltaMinor,
      appliedAmendment: Object.freeze({ id: amendment.id, direction: amendment.direction, deltaMinor: amendment.deltaMinor }),
    });
  }

  const amendmentRefund = amendmentSettlement.adjustment;
  const effectiveTransactions: BookingSettlementTransaction[] = [
    ...input.originalTransactions,
    {
      kind: 'REFUND',
      status: 'SUCCEEDED',
      providerCode: amendmentRefund.providerCode,
      providerReference: amendmentRefund.providerReference,
      sourceProviderReference: amendmentRefund.sourceProviderReference,
      currency: amendmentRefund.currency,
      amountMinor: amendmentRefund.amountMinor,
    },
  ];
  const effectiveBookingPriceSettlement = deriveRentalPaymentSettlement({
    bookingTotalMinor: input.originalBookingTotalMinor,
    currency: input.currency,
    transactions: effectiveTransactions,
  });
  if (!effectiveBookingPriceSettlement.reconciled) {
    return conflict(`Applied rental commercial amendment refund does not reconcile against retained booking-price sources. ${effectiveBookingPriceSettlement.reason}`);
  }

  return summarize({
    currency: input.currency,
    originalBookingTotalMinor: input.originalBookingTotalMinor,
    effectiveAcceptedTotalMinor: amendment.afterTotalMinor,
    originalBookingNetSettledMinor: originalSettlement.netSettledMinor,
    amendmentNetEffectMinor: -amendment.deltaMinor,
    currentNetSettledMinor: effectiveBookingPriceSettlement.netSettledMinor,
    bookingPriceRefundRemainingMinor: effectiveBookingPriceSettlement.netSettledMinor,
    amendmentChargeRefundRemainingMinor: 0n,
    appliedAmendment: Object.freeze({ id: amendment.id, direction: amendment.direction, deltaMinor: amendment.deltaMinor }),
  });
}
