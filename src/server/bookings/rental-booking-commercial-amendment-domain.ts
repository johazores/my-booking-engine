import { createHash } from 'node:crypto';

import {
  normalizeRentalBookingRescheduleReviewInput,
  type RentalBookingRescheduleMode,
} from './rental-booking-reschedule-domain.ts';

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const COMMERCIAL_AMENDMENT_WINDOW_MINUTES = 15;

export class RentalBookingCommercialAmendmentValidationError extends Error {}

export type RentalBookingCommercialAmendmentDirection = 'ADDITIONAL_CHARGE' | 'REFUND';

export type RentalBookingCommercialAmendmentPreparationInput = Readonly<{
  startsOn: unknown;
  endsOn: unknown;
  reviewFingerprint: unknown;
}>;

export function normalizeRentalBookingCommercialAmendmentPreparationInput(
  input: RentalBookingCommercialAmendmentPreparationInput,
) {
  if (typeof input.startsOn !== 'string' || typeof input.endsOn !== 'string') {
    throw new RentalBookingCommercialAmendmentValidationError(
      'Rental commercial amendment target dates are invalid.',
    );
  }
  const range = normalizeRentalBookingRescheduleReviewInput({ startsOn: input.startsOn, endsOn: input.endsOn });
  if (typeof input.reviewFingerprint !== 'string') {
    throw new RentalBookingCommercialAmendmentValidationError(
      'Rental commercial amendment review fingerprint is invalid.',
    );
  }
  const reviewFingerprint = input.reviewFingerprint.trim().toLowerCase();
  if (!FINGERPRINT_PATTERN.test(reviewFingerprint)) {
    throw new RentalBookingCommercialAmendmentValidationError(
      'Rental commercial amendment review fingerprint is invalid.',
    );
  }
  return Object.freeze({ ...range, reviewFingerprint });
}

export function rentalBookingCommercialAmendmentExpiresAt(now: Date) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RentalBookingCommercialAmendmentValidationError(
      'Rental commercial amendment expiry requires a valid database timestamp.',
    );
  }
  return new Date(now.getTime() + COMMERCIAL_AMENDMENT_WINDOW_MINUTES * 60_000);
}

export function rentalBookingCommercialAmendmentDirection(input: Readonly<{
  beforeTotalMinor: bigint;
  afterTotalMinor: bigint;
}>): RentalBookingCommercialAmendmentDirection {
  if (input.beforeTotalMinor < 0n || input.afterTotalMinor < 0n) {
    throw new RentalBookingCommercialAmendmentValidationError(
      'Rental commercial amendment totals cannot be negative.',
    );
  }
  if (input.beforeTotalMinor === input.afterTotalMinor) {
    throw new RentalBookingCommercialAmendmentValidationError(
      'Rental commercial amendment requires a non-zero price change.',
    );
  }
  return input.afterTotalMinor > input.beforeTotalMinor ? 'ADDITIONAL_CHARGE' : 'REFUND';
}

export function buildRentalBookingCommercialAmendmentIdempotencyKey(
  bookingId: string,
  reviewFingerprint: string,
) {
  const digest = createHash('sha256')
    .update(`rental-commercial-amendment\u001f${bookingId}\u001f${reviewFingerprint}`, 'utf8')
    .digest('hex');
  return `rental-amendment:${digest.slice(0, 48)}`;
}

export function buildRentalBookingCommercialAmendmentReviewFingerprint(input: Readonly<{
  organizationId: string;
  bookingId: string;
  bookingUpdatedAt: Date;
  unitId: string;
  unitTypeId: string;
  locationId: string;
  sourceStartsOn: Date;
  sourceEndsOn: Date;
  targetStartsOn: Date;
  targetEndsOn: Date;
  currency: string;
  beforeTotalMinor: bigint;
  afterTotalMinor: bigint;
  sourcePricingFingerprint: string;
  targetPricingFingerprint: string;
  mode: RentalBookingRescheduleMode;
  pickupEventId: string | null;
}>) {
  const direction = rentalBookingCommercialAmendmentDirection({
    beforeTotalMinor: input.beforeTotalMinor,
    afterTotalMinor: input.afterTotalMinor,
  });
  const deltaMinor = input.afterTotalMinor > input.beforeTotalMinor
    ? input.afterTotalMinor - input.beforeTotalMinor
    : input.beforeTotalMinor - input.afterTotalMinor;
  const snapshot = {
    version: 1,
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    bookingUpdatedAt: input.bookingUpdatedAt.toISOString(),
    unitId: input.unitId,
    unitTypeId: input.unitTypeId,
    locationId: input.locationId,
    sourceStartsOn: input.sourceStartsOn.toISOString().slice(0, 10),
    sourceEndsOn: input.sourceEndsOn.toISOString().slice(0, 10),
    targetStartsOn: input.targetStartsOn.toISOString().slice(0, 10),
    targetEndsOn: input.targetEndsOn.toISOString().slice(0, 10),
    currency: input.currency,
    beforeTotalMinor: input.beforeTotalMinor.toString(),
    afterTotalMinor: input.afterTotalMinor.toString(),
    deltaMinor: deltaMinor.toString(),
    direction,
    sourcePricingFingerprint: input.sourcePricingFingerprint,
    targetPricingFingerprint: input.targetPricingFingerprint,
    mode: input.mode,
    pickupEventId: input.pickupEventId,
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
