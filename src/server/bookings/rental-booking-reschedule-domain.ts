import { createHash } from 'node:crypto';

import { normalizeRentalDateRange, RentalInventoryValidationError } from '../inventory/rental-domain.ts';

const MAX_RENTAL_RESCHEDULE_DAYS = 90;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export class RentalBookingRescheduleValidationError extends Error {}

export type RentalBookingRescheduleMode = 'PRE_PICKUP_RESCHEDULE' | 'CUSTODY_EXTENSION';
export type RentalBookingRescheduleCommercialImpactKind =
  | 'UNCHANGED'
  | 'INCREASE'
  | 'DECREASE'
  | 'CURRENCY_CHANGED';

export type RentalBookingRescheduleReviewInput = Readonly<{
  startsOn: string;
  endsOn: string;
}>;

export type RentalBookingRescheduleApplyInput = Readonly<{
  startsOn: string;
  endsOn: string;
  idempotencyKey: string;
  authorityFingerprint: string;
}>;

export function normalizeRentalBookingRescheduleReviewInput(input: RentalBookingRescheduleReviewInput) {
  const range = normalizeRentalDateRange(input);
  const days = (range.endsOn.getTime() - range.startsOn.getTime()) / 86_400_000;
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_RENTAL_RESCHEDULE_DAYS) {
    throw new RentalInventoryValidationError(
      `Rental reschedule reviews cannot exceed ${MAX_RENTAL_RESCHEDULE_DAYS} days.`,
    );
  }
  return Object.freeze({ ...range, days });
}

export function normalizeRentalBookingRescheduleApplyInput(input: RentalBookingRescheduleApplyInput) {
  const range = normalizeRentalBookingRescheduleReviewInput(input);
  const idempotencyKey = input.idempotencyKey.trim();
  const authorityFingerprint = input.authorityFingerprint.trim().toLowerCase();
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new RentalBookingRescheduleValidationError(
      'Idempotency key must be 8-120 letters, numbers, dots, underscores, colons, or hyphens.',
    );
  }
  if (!FINGERPRINT_PATTERN.test(authorityFingerprint)) {
    throw new RentalBookingRescheduleValidationError('Rental reschedule authority fingerprint is invalid.');
  }
  return Object.freeze({ ...range, idempotencyKey, authorityFingerprint });
}

export function buildRentalBookingRescheduleCommercialImpact(input: Readonly<{
  acceptedCurrency: string;
  acceptedTotalMinor: bigint;
  targetCurrency: string;
  targetTotalMinor: bigint;
}>) {
  const acceptedCurrency = input.acceptedCurrency.trim().toUpperCase();
  const targetCurrency = input.targetCurrency.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(acceptedCurrency) || !CURRENCY_PATTERN.test(targetCurrency)) {
    throw new RentalBookingRescheduleValidationError('Rental reschedule commercial impact requires valid ISO currency codes.');
  }
  if (input.acceptedTotalMinor < 0n || input.targetTotalMinor < 0n) {
    throw new RentalBookingRescheduleValidationError('Rental reschedule commercial impact cannot use negative totals.');
  }

  if (acceptedCurrency !== targetCurrency) {
    return Object.freeze({
      kind: 'CURRENCY_CHANGED' as const,
      acceptedCurrency,
      acceptedTotalMinor: input.acceptedTotalMinor,
      targetCurrency,
      targetTotalMinor: input.targetTotalMinor,
      deltaMinor: null,
    });
  }

  const signedDeltaMinor = input.targetTotalMinor - input.acceptedTotalMinor;
  const kind: Exclude<RentalBookingRescheduleCommercialImpactKind, 'CURRENCY_CHANGED'> = signedDeltaMinor === 0n
    ? 'UNCHANGED'
    : signedDeltaMinor > 0n
      ? 'INCREASE'
      : 'DECREASE';

  return Object.freeze({
    kind,
    acceptedCurrency,
    acceptedTotalMinor: input.acceptedTotalMinor,
    targetCurrency,
    targetTotalMinor: input.targetTotalMinor,
    deltaMinor: signedDeltaMinor < 0n ? -signedDeltaMinor : signedDeltaMinor,
  });
}

export function isRentalBookingCustodyExtensionTarget(input: Readonly<{
  sourceStartsOn: Date;
  sourceEndsOn: Date;
  targetStartsOn: Date;
  targetEndsOn: Date;
}>) {
  return input.targetStartsOn.getTime() === input.sourceStartsOn.getTime()
    && input.targetEndsOn.getTime() > input.sourceEndsOn.getTime();
}

export function buildRentalBookingRescheduleIdempotencyKey(bookingId: string, authorityFingerprint: string) {
  const digest = createHash('sha256').update(`${bookingId}:${authorityFingerprint}`).digest('hex');
  return `rental-reschedule:${digest}`;
}

export function rentalBookingLockKey(organizationId: string, bookingId: string) {
  return `sf:rental-booking:${organizationId}:booking:${bookingId}`;
}

export function buildRentalBookingRescheduleAuthorityFingerprint(input: Readonly<{
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
  totalMinor: bigint;
  sourcePricingFingerprint: string;
  targetPricingFingerprint: string;
  mode: RentalBookingRescheduleMode;
  pickupEventId: string | null;
}>) {
  const snapshot = {
    version: 3,
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
    totalMinor: input.totalMinor.toString(),
    sourcePricingFingerprint: input.sourcePricingFingerprint,
    targetPricingFingerprint: input.targetPricingFingerprint,
    mode: input.mode,
    pickupEventId: input.pickupEventId,
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
