import { createHash } from 'node:crypto';

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

export type RentalBookingConversionAuthorityEvidence = Readonly<{
  organizationId: string;
  holdId: string;
  customerId: string;
  unitId: string;
  unitTypeId: string;
  locationId: string;
  startsOn: Date;
  endsOn: Date;
  holdExpiresAt: Date;
  currency: string;
  totalMinor: bigint;
  pricingFingerprint: string;
}>;

function assertNonBlank(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function assertFingerprint(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!FINGERPRINT_PATTERN.test(normalized)) {
    throw new Error('Rental pricing fingerprint is invalid.');
  }
  return normalized;
}

function assertDate(value: Date, field: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${field} is invalid.`);
  }
  return value;
}

export function buildRentalBookingConversionAuthorityFingerprint(
  evidence: RentalBookingConversionAuthorityEvidence,
) {
  const startsOn = assertDate(evidence.startsOn, 'startsOn');
  const endsOn = assertDate(evidence.endsOn, 'endsOn');
  const holdExpiresAt = assertDate(evidence.holdExpiresAt, 'holdExpiresAt');
  if (startsOn >= endsOn) throw new Error('Rental booking date range is invalid.');
  if (evidence.totalMinor <= 0n) throw new Error('Rental booking total must be positive.');

  const canonical = JSON.stringify([
    'sf:rental-booking-conversion-authority:v1',
    assertNonBlank(evidence.organizationId, 'organizationId'),
    assertNonBlank(evidence.holdId, 'holdId'),
    assertNonBlank(evidence.customerId, 'customerId'),
    assertNonBlank(evidence.unitId, 'unitId'),
    assertNonBlank(evidence.unitTypeId, 'unitTypeId'),
    assertNonBlank(evidence.locationId, 'locationId'),
    startsOn.toISOString().slice(0, 10),
    endsOn.toISOString().slice(0, 10),
    holdExpiresAt.toISOString(),
    assertNonBlank(evidence.currency, 'currency').toUpperCase(),
    evidence.totalMinor.toString(),
    assertFingerprint(evidence.pricingFingerprint),
  ]);

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
