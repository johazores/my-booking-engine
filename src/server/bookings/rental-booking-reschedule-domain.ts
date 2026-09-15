import { createHash } from 'node:crypto';

import { normalizeRentalDateRange, RentalInventoryValidationError } from '../inventory/rental-domain.ts';

const MAX_RENTAL_RESCHEDULE_DAYS = 90;

export type RentalBookingRescheduleReviewInput = Readonly<{
  startsOn: string;
  endsOn: string;
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

export function buildRentalBookingRescheduleAuthorityFingerprint(input: Readonly<{
  organizationId: string;
  bookingId: string;
  bookingUpdatedAt: Date;
  unitId: string;
  unitTypeId: string;
  locationId: string;
  startsOn: Date;
  endsOn: Date;
  currency: string;
  totalMinor: bigint;
  sourcePricingFingerprint: string;
  targetPricingFingerprint: string;
}>) {
  const snapshot = {
    version: 1,
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    bookingUpdatedAt: input.bookingUpdatedAt.toISOString(),
    unitId: input.unitId,
    unitTypeId: input.unitTypeId,
    locationId: input.locationId,
    startsOn: input.startsOn.toISOString().slice(0, 10),
    endsOn: input.endsOn.toISOString().slice(0, 10),
    currency: input.currency,
    totalMinor: input.totalMinor.toString(),
    sourcePricingFingerprint: input.sourcePricingFingerprint,
    targetPricingFingerprint: input.targetPricingFingerprint,
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
