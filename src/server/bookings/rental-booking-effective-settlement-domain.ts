import { deriveNextBookingRefundSource } from '../payments/payment-refund-allocation-domain.ts';
import {
  deriveBookingSettlementSummary,
  type BookingSettlementTransaction,
} from '../payments/payment-settlement-domain.ts';
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

export type RentalBookingEffectiveRefundEvidence = Readonly<{
  sourceLedger: 'BOOKING_PRICE' | 'COMMERCIAL_AMENDMENT';
  status: 'SUCCEEDED';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string;
  currency: string;
  amountMinor: bigint;
}>;

export type RentalBookingEffectiveRefundSource = Readonly<{
  sourceLedger: 'BOOKING_PRICE' | 'COMMERCIAL_AMENDMENT';
  providerCode: string;
  providerReference: string;
  sourceKind: 'OFFLINE_PAYMENT';
  currency: string;
  refundableMinor: bigint;
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
      nextRefundSource: RentalBookingEffectiveRefundSource | null;
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

function deriveBookingPriceNextRefundSource(input: Readonly<{
  currency: string;
  transactions: readonly BookingSettlementTransaction[];
  expectedRefundableMinor: bigint;
}>): RentalBookingEffectiveRefundSource | null | string {
  if (input.expectedRefundableMinor === 0n) return null;
  const summary = deriveBookingSettlementSummary({
    currency: input.currency,
    transactions: input.transactions,
  });
  if (!summary.reconciled) return `Effective booking-price refund sources are unreconciled. ${summary.reason}`;
  const allocation = deriveNextBookingRefundSource({ sources: summary.sources });
  if (!allocation.allocated) return allocation.reason;
  if (
    allocation.providerCode !== 'manual'
    || allocation.sourceKind !== 'OFFLINE_PAYMENT'
    || allocation.currency !== input.currency
    || allocation.bookingRefundableMinor !== input.expectedRefundableMinor
  ) {
    return 'Effective booking-price refund source does not match the supported manual/offline settlement contract.';
  }
  return Object.freeze({
    sourceLedger: 'BOOKING_PRICE' as const,
    providerCode: allocation.providerCode,
    providerReference: allocation.providerReference,
    sourceKind: 'OFFLINE_PAYMENT' as const,
    currency: allocation.currency,
    refundableMinor: allocation.sourceRefundableMinor,
  });
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
  nextRefundSource: RentalBookingEffectiveRefundSource | null;
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
  if ((input.currentNetSettledMinor === 0n) !== (input.nextRefundSource === null)) {
    return conflict('Effective rental next-refund authority does not reconcile to current settled money.');
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
    nextRefundSource: input.nextRefundSource,
    appliedAmendment: input.appliedAmendment,
  });
}

function normalizePostApplyRefundEvidence(input: Readonly<{
  currency: string;
  rows: readonly RentalBookingEffectiveRefundEvidence[];
}>) {
  const references = new Set<string>();
  const bookingPriceRows: BookingSettlementTransaction[] = [];
  const amendmentChargeRows: RentalBookingEffectiveRefundEvidence[] = [];

  for (const row of input.rows) {
    if (
      (row.sourceLedger !== 'BOOKING_PRICE' && row.sourceLedger !== 'COMMERCIAL_AMENDMENT')
      || row.status !== 'SUCCEEDED'
      || row.providerCode !== 'manual'
      || row.currency !== input.currency
      || row.amountMinor <= 0n
      || !row.providerReference.trim()
      || !row.sourceProviderReference.trim()
      || row.providerReference === row.sourceProviderReference
    ) {
      return { valid: false as const, reason: 'Post-apply rental refund evidence is malformed or outside the supported manual/offline contract.' };
    }
    if (references.has(row.providerReference)) {
      return { valid: false as const, reason: 'Post-apply rental refund evidence contains a duplicate provider reference.' };
    }
    references.add(row.providerReference);
    if (row.sourceLedger === 'BOOKING_PRICE') {
      bookingPriceRows.push({
        kind: 'REFUND',
        status: 'SUCCEEDED',
        providerCode: row.providerCode,
        providerReference: row.providerReference,
        sourceProviderReference: row.sourceProviderReference,
        currency: row.currency,
        amountMinor: row.amountMinor,
      });
    } else {
      amendmentChargeRows.push(row);
    }
  }

  return Object.freeze({
    valid: true as const,
    bookingPriceRows: Object.freeze(bookingPriceRows),
    amendmentChargeRows: Object.freeze(amendmentChargeRows),
  });
}

export function deriveRentalBookingEffectiveSettlement(input: Readonly<{
  originalBookingTotalMinor: bigint;
  currency: string;
  originalTransactions: readonly BookingSettlementTransaction[];
  appliedAmendment?: AppliedRentalBookingCommercialAmendmentSettlementEvidence | null;
  postApplyRefunds?: readonly RentalBookingEffectiveRefundEvidence[];
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

  const postApply = normalizePostApplyRefundEvidence({
    currency: input.currency,
    rows: input.postApplyRefunds ?? [],
  });
  if (!postApply.valid) return conflict(postApply.reason);

  const amendment = input.appliedAmendment ?? null;
  if (!amendment) {
    if (postApply.bookingPriceRows.length > 0 || postApply.amendmentChargeRows.length > 0) {
      return conflict('Post-apply rental refund evidence cannot exist without an applied commercial amendment.');
    }
    const next = deriveBookingPriceNextRefundSource({
      currency: input.currency,
      transactions: input.originalTransactions,
      expectedRefundableMinor: originalSettlement.netSettledMinor,
    });
    if (typeof next === 'string') return conflict(next);
    return summarize({
      currency: input.currency,
      originalBookingTotalMinor: input.originalBookingTotalMinor,
      effectiveAcceptedTotalMinor: input.originalBookingTotalMinor,
      originalBookingNetSettledMinor: originalSettlement.netSettledMinor,
      amendmentNetEffectMinor: 0n,
      currentNetSettledMinor: originalSettlement.netSettledMinor,
      bookingPriceRefundRemainingMinor: originalSettlement.netSettledMinor,
      amendmentChargeRefundRemainingMinor: 0n,
      nextRefundSource: next,
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
    const amendmentPayment = amendmentSettlement.adjustment;
    if (amendmentPayment.kind !== 'OFFLINE_PAYMENT' || amendmentPayment.sourceProviderReference !== null) {
      return conflict('Applied rental commercial amendment charge does not retain its authoritative payment source.');
    }
    for (const row of postApply.amendmentChargeRows) {
      if (row.sourceProviderReference !== amendmentPayment.providerReference) {
        return conflict('Post-apply amendment-charge refund does not reference the retained amendment payment source.');
      }
    }
    const amendmentChargeRefundedMinor = postApply.amendmentChargeRows.reduce((sum, row) => sum + row.amountMinor, 0n);
    if (amendmentChargeRefundedMinor > amendment.deltaMinor) {
      return conflict('Post-apply amendment-charge refunds exceed the retained amendment payment.');
    }

    const bookingPriceTransactions = [...input.originalTransactions, ...postApply.bookingPriceRows];
    const effectiveBookingPriceSettlement = deriveRentalPaymentSettlement({
      bookingTotalMinor: input.originalBookingTotalMinor,
      currency: input.currency,
      transactions: bookingPriceTransactions,
    });
    if (!effectiveBookingPriceSettlement.reconciled) {
      return conflict(`Post-apply booking-price refunds do not reconcile against retained sources. ${effectiveBookingPriceSettlement.reason}`);
    }
    const amendmentChargeRefundRemainingMinor = amendment.deltaMinor - amendmentChargeRefundedMinor;
    const currentNetSettledMinor = effectiveBookingPriceSettlement.netSettledMinor + amendmentChargeRefundRemainingMinor;
    let nextRefundSource: RentalBookingEffectiveRefundSource | null;
    if (amendmentChargeRefundRemainingMinor > 0n) {
      nextRefundSource = Object.freeze({
        sourceLedger: 'COMMERCIAL_AMENDMENT',
        providerCode: amendmentPayment.providerCode,
        providerReference: amendmentPayment.providerReference,
        sourceKind: 'OFFLINE_PAYMENT',
        currency: amendmentPayment.currency,
        refundableMinor: amendmentChargeRefundRemainingMinor,
      });
    } else {
      const next = deriveBookingPriceNextRefundSource({
        currency: input.currency,
        transactions: bookingPriceTransactions,
        expectedRefundableMinor: effectiveBookingPriceSettlement.netSettledMinor,
      });
      if (typeof next === 'string') return conflict(next);
      nextRefundSource = next;
    }

    return summarize({
      currency: input.currency,
      originalBookingTotalMinor: input.originalBookingTotalMinor,
      effectiveAcceptedTotalMinor: amendment.afterTotalMinor,
      originalBookingNetSettledMinor: originalSettlement.netSettledMinor,
      amendmentNetEffectMinor: amendment.deltaMinor,
      currentNetSettledMinor,
      bookingPriceRefundRemainingMinor: effectiveBookingPriceSettlement.netSettledMinor,
      amendmentChargeRefundRemainingMinor,
      nextRefundSource,
      appliedAmendment: Object.freeze({ id: amendment.id, direction: amendment.direction, deltaMinor: amendment.deltaMinor }),
    });
  }

  if (postApply.amendmentChargeRows.length > 0) {
    return conflict('An applied rental decrease cannot retain amendment-charge refund evidence.');
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
    ...postApply.bookingPriceRows,
  ];
  const effectiveBookingPriceSettlement = deriveRentalPaymentSettlement({
    bookingTotalMinor: input.originalBookingTotalMinor,
    currency: input.currency,
    transactions: effectiveTransactions,
  });
  if (!effectiveBookingPriceSettlement.reconciled) {
    return conflict(`Applied rental commercial amendment refund does not reconcile against retained booking-price sources. ${effectiveBookingPriceSettlement.reason}`);
  }
  const next = deriveBookingPriceNextRefundSource({
    currency: input.currency,
    transactions: effectiveTransactions,
    expectedRefundableMinor: effectiveBookingPriceSettlement.netSettledMinor,
  });
  if (typeof next === 'string') return conflict(next);

  return summarize({
    currency: input.currency,
    originalBookingTotalMinor: input.originalBookingTotalMinor,
    effectiveAcceptedTotalMinor: amendment.afterTotalMinor,
    originalBookingNetSettledMinor: originalSettlement.netSettledMinor,
    amendmentNetEffectMinor: -amendment.deltaMinor,
    currentNetSettledMinor: effectiveBookingPriceSettlement.netSettledMinor,
    bookingPriceRefundRemainingMinor: effectiveBookingPriceSettlement.netSettledMinor,
    amendmentChargeRefundRemainingMinor: 0n,
    nextRefundSource: next,
    appliedAmendment: Object.freeze({ id: amendment.id, direction: amendment.direction, deltaMinor: amendment.deltaMinor }),
  });
}
