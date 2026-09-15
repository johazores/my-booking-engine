import { createHash } from 'node:crypto';

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

export class RentalBookingUnitSubstitutionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingUnitSubstitutionValidationError';
  }
}

export function normalizeRentalBookingUnitSubstitutionSearch(value: string | undefined) {
  const query = value?.trim() ?? '';
  if (query.length > 80) {
    throw new RentalBookingUnitSubstitutionValidationError(
      'Rental unit search cannot exceed 80 characters.',
    );
  }
  return query;
}

export function buildRentalBookingUnitSubstitutionAuthorityFingerprint(input: Readonly<{
  organizationId: string;
  bookingId: string;
  bookingUpdatedAt: Date;
  sourceUnitId: string;
  targetUnitId: string;
  unitTypeId: string;
  locationId: string;
  startsOn: Date;
  endsOn: Date;
  currency: string;
  totalMinor: bigint;
  pricingFingerprint: string;
}>) {
  if (!FINGERPRINT_PATTERN.test(input.pricingFingerprint)) {
    throw new RentalBookingUnitSubstitutionValidationError(
      'Effective rental pricing fingerprint is invalid.',
    );
  }

  const snapshot = {
    version: 1,
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    bookingUpdatedAt: input.bookingUpdatedAt.toISOString(),
    sourceUnitId: input.sourceUnitId,
    targetUnitId: input.targetUnitId,
    unitTypeId: input.unitTypeId,
    locationId: input.locationId,
    startsOn: input.startsOn.toISOString().slice(0, 10),
    endsOn: input.endsOn.toISOString().slice(0, 10),
    currency: input.currency,
    totalMinor: input.totalMinor.toString(),
    pricingFingerprint: input.pricingFingerprint,
  };

  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
