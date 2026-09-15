import { createHash } from 'node:crypto';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

export class RentalBookingUnitSubstitutionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingUnitSubstitutionValidationError';
  }
}

export type RentalBookingUnitSubstitutionApplyInput = Readonly<{
  targetUnitId: string;
  idempotencyKey: string;
  authorityFingerprint: string;
}>;

export function normalizeRentalBookingUnitSubstitutionSearch(value: string | undefined) {
  const query = value?.trim() ?? '';
  if (query.length > 80) {
    throw new RentalBookingUnitSubstitutionValidationError(
      'Rental unit search cannot exceed 80 characters.',
    );
  }
  return query;
}

export function normalizeRentalBookingUnitSubstitutionApplyInput(
  input: RentalBookingUnitSubstitutionApplyInput,
) {
  const targetUnitId = input.targetUnitId.trim().toLowerCase();
  const idempotencyKey = input.idempotencyKey.trim();
  const authorityFingerprint = input.authorityFingerprint.trim().toLowerCase();
  if (!/^[a-f0-9-]{36}$/.test(targetUnitId)) {
    throw new RentalBookingUnitSubstitutionValidationError('Target rental unit identifier is invalid.');
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new RentalBookingUnitSubstitutionValidationError(
      'Idempotency key must be 8-120 letters, numbers, dots, underscores, colons, or hyphens.',
    );
  }
  if (!FINGERPRINT_PATTERN.test(authorityFingerprint)) {
    throw new RentalBookingUnitSubstitutionValidationError(
      'Rental unit substitution authority fingerprint is invalid.',
    );
  }
  return Object.freeze({ targetUnitId, idempotencyKey, authorityFingerprint });
}

export function buildRentalBookingUnitSubstitutionIdempotencyKey(
  bookingId: string,
  targetUnitId: string,
  authorityFingerprint: string,
) {
  const digest = createHash('sha256')
    .update(`${bookingId}:${targetUnitId}:${authorityFingerprint}`)
    .digest('hex');
  return `rental-unit-substitution:${digest}`;
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
    version: 2,
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
