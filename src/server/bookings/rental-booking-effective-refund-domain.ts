import { createHash } from 'node:crypto';

import type {
  RentalBookingEffectiveRefundSource,
  RentalBookingEffectiveSettlement,
} from './rental-booking-effective-settlement-domain.ts';

export type RentalBookingEffectiveRefundPlan = Readonly<
  | {
      planned: true;
      sourceLedger: RentalBookingEffectiveRefundSource['sourceLedger'];
      providerCode: string;
      sourceProviderReference: string;
      currency: string;
      amountMinor: bigint;
      sourceRefundableMinor: bigint;
      effectiveRefundableMinor: bigint;
    }
  | {
      planned: false;
      reason: string;
    }
>;

export function deriveRentalBookingEffectiveRefundPlan(input: Readonly<{
  settlement: RentalBookingEffectiveSettlement;
  requestedAmountMinor: bigint;
}>): RentalBookingEffectiveRefundPlan {
  if (!input.settlement.reconciled) {
    return Object.freeze({
      planned: false as const,
      reason: `Effective rental settlement must reconcile before refunding. ${input.settlement.reason}`,
    });
  }
  if (!input.settlement.appliedAmendment) {
    return Object.freeze({
      planned: false as const,
      reason: 'Post-apply rental refund authority requires an applied commercial amendment.',
    });
  }
  if (input.requestedAmountMinor <= 0n) {
    return Object.freeze({
      planned: false as const,
      reason: 'Post-apply rental refund amount must be greater than zero.',
    });
  }
  const source = input.settlement.nextRefundSource;
  if (!source || input.settlement.currentNetSettledMinor === 0n) {
    return Object.freeze({
      planned: false as const,
      reason: 'This rental has no remaining post-apply refundable balance.',
    });
  }
  if (source.providerCode !== 'manual' || source.sourceKind !== 'OFFLINE_PAYMENT') {
    return Object.freeze({
      planned: false as const,
      reason: 'Post-apply rental refund source is outside the enabled manual/offline provider contract.',
    });
  }
  if (input.requestedAmountMinor > source.refundableMinor) {
    return Object.freeze({
      planned: false as const,
      reason: 'One post-apply refund cannot span settlement sources. Record an amount within the current authoritative source balance.',
    });
  }
  if (source.refundableMinor > input.settlement.currentNetSettledMinor) {
    return Object.freeze({
      planned: false as const,
      reason: 'Post-apply rental refund source exceeds the reconciled effective balance.',
    });
  }

  return Object.freeze({
    planned: true as const,
    sourceLedger: source.sourceLedger,
    providerCode: source.providerCode,
    sourceProviderReference: source.providerReference,
    currency: source.currency,
    amountMinor: input.requestedAmountMinor,
    sourceRefundableMinor: source.refundableMinor,
    effectiveRefundableMinor: input.settlement.currentNetSettledMinor,
  });
}

export function buildRentalBookingEffectiveRefundIdempotencyKey(input: Readonly<{
  bookingId: string;
  amendmentId: string;
  reference: string;
}>) {
  const digest = createHash('sha256')
    .update([
      'rental-effective-refund-v1',
      input.bookingId,
      input.amendmentId,
      input.reference,
    ].join('\u001f'), 'utf8')
    .digest('hex');
  return `rental-effective-refund:${digest.slice(0, 48)}`;
}

export function buildRentalBookingEffectiveRefundRequestFingerprint(input: Readonly<{
  organizationId: string;
  bookingId: string;
  amendmentId: string;
  idempotencyKey: string;
  sourceLedger: 'BOOKING_PRICE' | 'COMMERCIAL_AMENDMENT';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string;
  currency: string;
  amountMinor: bigint;
}>) {
  return createHash('sha256')
    .update([
      'rental-effective-refund-request-v1',
      input.organizationId,
      input.bookingId,
      input.amendmentId,
      input.idempotencyKey,
      input.sourceLedger,
      input.providerCode,
      input.providerReference,
      input.sourceProviderReference,
      input.currency,
      input.amountMinor.toString(),
    ].join('\u001f'), 'utf8')
    .digest('hex');
}
