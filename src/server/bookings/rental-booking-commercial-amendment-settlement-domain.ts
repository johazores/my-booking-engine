import { createHash } from 'node:crypto';

import { deriveNextBookingRefundSource } from '../payments/payment-refund-allocation-domain.ts';
import type { BookingSettlementSource } from '../payments/payment-settlement-domain.ts';

export type RentalBookingCommercialAmendmentSettlementDirection = 'ADDITIONAL_CHARGE' | 'REFUND';
export type RentalBookingCommercialAmendmentSettlementPurpose = 'ADJUSTMENT' | 'COMPENSATION';
export type RentalBookingCommercialAmendmentSettlementKind = 'OFFLINE_PAYMENT' | 'REFUND';

export type RentalBookingCommercialAmendmentSettlementRow = Readonly<{
  purpose: RentalBookingCommercialAmendmentSettlementPurpose;
  kind: RentalBookingCommercialAmendmentSettlementKind;
  status: 'SUCCEEDED';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>;

export type RentalBookingCommercialAmendmentSettlementState = Readonly<
  | { state: 'UNSETTLED'; settled: false; compensated: false }
  | {
      state: 'SETTLED';
      settled: true;
      compensated: false;
      adjustment: RentalBookingCommercialAmendmentSettlementRow;
    }
  | {
      state: 'COMPENSATED';
      settled: false;
      compensated: true;
      adjustment: RentalBookingCommercialAmendmentSettlementRow;
      compensation: RentalBookingCommercialAmendmentSettlementRow;
    }
  | { state: 'CONFLICT'; settled: false; compensated: false; reason: string }
>;

export type RentalBookingCommercialAmendmentPriorRefund = Readonly<{
  providerCode: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>;

export type RentalBookingCommercialAmendmentRefundSource = Readonly<
  | {
      available: true;
      providerCode: 'manual';
      providerReference: string;
      currency: string;
      refundableMinor: bigint;
      totalRefundableMinor: bigint;
    }
  | { available: false; reason: string }
>;

type SettlementInput = Readonly<{
  direction: RentalBookingCommercialAmendmentSettlementDirection;
  currency: string;
  deltaMinor: bigint;
  rows: readonly RentalBookingCommercialAmendmentSettlementRow[];
}>;

function conflict(reason: string): RentalBookingCommercialAmendmentSettlementState {
  return Object.freeze({ state: 'CONFLICT', settled: false, compensated: false, reason });
}

function refundSourceUnavailable(reason: string): RentalBookingCommercialAmendmentRefundSource {
  return Object.freeze({ available: false as const, reason });
}

function expectedAdjustmentKind(direction: RentalBookingCommercialAmendmentSettlementDirection) {
  return direction === 'ADDITIONAL_CHARGE' ? 'OFFLINE_PAYMENT' as const : 'REFUND' as const;
}

function expectedCompensationKind(direction: RentalBookingCommercialAmendmentSettlementDirection) {
  return direction === 'ADDITIONAL_CHARGE' ? 'REFUND' as const : 'OFFLINE_PAYMENT' as const;
}

function validateCommon(
  row: RentalBookingCommercialAmendmentSettlementRow,
  input: SettlementInput,
): string | null {
  if (row.status !== 'SUCCEEDED') return 'Commercial amendment settlement contains unresolved evidence.';
  if (row.providerCode !== 'manual') return 'Commercial amendment settlement contains unsupported provider evidence.';
  if (row.currency !== input.currency) return 'Commercial amendment settlement currency does not match the amendment.';
  if (row.amountMinor !== input.deltaMinor) return 'Commercial amendment settlement amount does not match the exact amendment delta.';
  if (!row.providerReference.trim()) return 'Commercial amendment settlement reference is missing.';
  return null;
}

export function deriveRentalBookingCommercialAmendmentSettlementState(
  input: SettlementInput,
): RentalBookingCommercialAmendmentSettlementState {
  if (!/^[A-Z]{3}$/.test(input.currency)) return conflict('Commercial amendment currency is invalid.');
  if (input.deltaMinor <= 0n) return conflict('Commercial amendment delta must be positive.');
  if (input.rows.length > 2) return conflict('Commercial amendment settlement exceeds the supported adjustment and compensation evidence.');

  const adjustmentRows = input.rows.filter((row) => row.purpose === 'ADJUSTMENT');
  const compensationRows = input.rows.filter((row) => row.purpose === 'COMPENSATION');
  if (adjustmentRows.length > 1 || compensationRows.length > 1) {
    return conflict('Commercial amendment settlement contains duplicate lifecycle evidence.');
  }

  const adjustment = adjustmentRows[0] ?? null;
  const compensation = compensationRows[0] ?? null;
  if (!adjustment && compensation) return conflict('Commercial amendment compensation exists without retained adjustment evidence.');
  if (!adjustment) return Object.freeze({ state: 'UNSETTLED', settled: false, compensated: false });

  const adjustmentCommonError = validateCommon(adjustment, input);
  if (adjustmentCommonError) return conflict(adjustmentCommonError);
  if (adjustment.kind !== expectedAdjustmentKind(input.direction)) {
    return conflict('Commercial amendment adjustment kind does not match the amendment direction.');
  }
  if (adjustment.kind === 'OFFLINE_PAYMENT' && adjustment.sourceProviderReference !== null) {
    return conflict('Commercial amendment payment unexpectedly contains refund-source attribution.');
  }
  if (adjustment.kind === 'REFUND' && !adjustment.sourceProviderReference?.trim()) {
    return conflict('Commercial amendment refund is missing original payment-source attribution.');
  }

  if (!compensation) {
    return Object.freeze({ state: 'SETTLED', settled: true, compensated: false, adjustment });
  }

  const compensationCommonError = validateCommon(compensation, input);
  if (compensationCommonError) return conflict(compensationCommonError);
  if (compensation.kind !== expectedCompensationKind(input.direction)) {
    return conflict('Commercial amendment compensation kind does not reverse the retained adjustment.');
  }
  if (compensation.providerReference === adjustment.providerReference) {
    return conflict('Commercial amendment compensation must retain a distinct real-world reference.');
  }
  if (compensation.kind === 'REFUND') {
    if (compensation.sourceProviderReference !== adjustment.providerReference) {
      return conflict('Commercial amendment compensation refund must reference the retained adjustment payment.');
    }
  } else if (compensation.sourceProviderReference !== null) {
    return conflict('Commercial amendment compensation payment unexpectedly contains refund-source attribution.');
  }

  return Object.freeze({
    state: 'COMPENSATED',
    settled: false,
    compensated: true,
    adjustment,
    compensation,
  });
}

export function deriveRentalBookingCommercialAmendmentRefundSource(input: Readonly<{
  currency: string;
  deltaMinor: bigint;
  bookingSources: readonly BookingSettlementSource[];
  priorAmendmentRefunds: readonly RentalBookingCommercialAmendmentPriorRefund[];
}>): RentalBookingCommercialAmendmentRefundSource {
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    return refundSourceUnavailable('Commercial amendment refund currency is invalid.');
  }
  if (input.deltaMinor <= 0n) {
    return refundSourceUnavailable('Commercial amendment refund amount must be positive.');
  }

  const sources = input.bookingSources.map((source) => ({ ...source }));
  const sourceByReference = new Map<string, (typeof sources)[number]>();
  for (const source of sources) {
    if (
      source.providerCode !== 'manual'
      || source.kind !== 'OFFLINE_PAYMENT'
      || source.currency !== input.currency
    ) {
      return refundSourceUnavailable('Commercial amendment refund source history is outside the supported manual booking-price contract.');
    }
    if (sourceByReference.has(source.providerReference)) {
      return refundSourceUnavailable('Commercial amendment refund source history contains duplicate retained payment references.');
    }
    sourceByReference.set(source.providerReference, source);
  }

  for (const refund of input.priorAmendmentRefunds) {
    if (
      refund.providerCode !== 'manual'
      || refund.currency !== input.currency
      || refund.amountMinor <= 0n
      || !refund.sourceProviderReference?.trim()
    ) {
      return refundSourceUnavailable('Prior commercial amendment refund evidence is malformed or outside the supported manual contract.');
    }
    const source = sourceByReference.get(refund.sourceProviderReference);
    if (!source) {
      return refundSourceUnavailable('Prior commercial amendment refund evidence references a booking-price source that is no longer reconcilable.');
    }
    if (refund.amountMinor > source.remainingMinor) {
      return refundSourceUnavailable('Prior commercial amendment refunds exceed the remaining value of a retained booking-price source.');
    }
    source.refundedMinor += refund.amountMinor;
    source.remainingMinor -= refund.amountMinor;
  }

  const allocation = deriveNextBookingRefundSource({ sources });
  if (!allocation.allocated) return refundSourceUnavailable(allocation.reason);
  if (
    allocation.providerCode !== 'manual'
    || allocation.sourceKind !== 'OFFLINE_PAYMENT'
    || allocation.currency !== input.currency
  ) {
    return refundSourceUnavailable('Commercial amendment refund source does not match the supported manual booking-price contract.');
  }
  if (allocation.sourceRefundableMinor < input.deltaMinor) {
    return refundSourceUnavailable('No single retained booking-price payment source can cover the exact commercial amendment refund.');
  }

  return Object.freeze({
    available: true as const,
    providerCode: 'manual' as const,
    providerReference: allocation.providerReference,
    currency: allocation.currency,
    refundableMinor: allocation.sourceRefundableMinor,
    totalRefundableMinor: allocation.bookingRefundableMinor,
  });
}

export function buildRentalBookingCommercialAmendmentSettlementIdempotencyKey(input: Readonly<{
  amendmentId: string;
  purpose: RentalBookingCommercialAmendmentSettlementPurpose;
  reference: string;
}>) {
  const digest = createHash('sha256')
    .update(`rental-amendment-settlement\u001f${input.purpose}\u001f${input.amendmentId}\u001f${input.reference}`, 'utf8')
    .digest('hex');
  return `rental-amendment-settlement:${input.purpose.toLowerCase()}:${digest.slice(0, 48)}`;
}

export function buildRentalBookingCommercialAmendmentSettlementRequestFingerprint(input: Readonly<{
  organizationId: string;
  bookingId: string;
  amendmentId: string;
  idempotencyKey: string;
  purpose: RentalBookingCommercialAmendmentSettlementPurpose;
  kind: RentalBookingCommercialAmendmentSettlementKind;
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>) {
  const snapshot = {
    version: 1,
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    amendmentId: input.amendmentId,
    idempotencyKey: input.idempotencyKey,
    purpose: input.purpose,
    kind: input.kind,
    providerCode: input.providerCode,
    providerReference: input.providerReference,
    sourceProviderReference: input.sourceProviderReference,
    currency: input.currency,
    amountMinor: input.amountMinor.toString(),
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
