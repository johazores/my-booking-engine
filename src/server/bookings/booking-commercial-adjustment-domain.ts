import { createHash } from 'node:crypto';

export type HospitalityBookingCommercialPriceSnapshot = {
  currency: string;
  accommodationSubtotalMinor: string;
  taxTotalMinor: string;
  feeTotalMinor: string;
  addonTotalMinor: string;
  totalMinor: string;
  pricingFingerprint: string;
};

export type HospitalityBookingCommercialAdjustmentDirection = 'NONE' | 'ADDITIONAL_CHARGE' | 'REFUND';

const MONEY_MINOR_PATTERN = /^\d+$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

function normalizeMinor(value: string, label: string) {
  if (typeof value !== 'string' || !MONEY_MINOR_PATTERN.test(value)) {
    throw new Error(`${label} must be a non-negative integer minor-unit string.`);
  }
  return BigInt(value).toString();
}

function normalizeFingerprint(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!FINGERPRINT_PATTERN.test(normalized)) throw new Error(`${label} must be a SHA-256 fingerprint.`);
  return normalized;
}

function normalizeSnapshot(
  snapshot: HospitalityBookingCommercialPriceSnapshot,
  label: string,
): HospitalityBookingCommercialPriceSnapshot {
  const currency = snapshot.currency.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) throw new Error(`${label} currency must use a three-letter ISO code.`);
  const normalized = {
    currency,
    accommodationSubtotalMinor: normalizeMinor(snapshot.accommodationSubtotalMinor, `${label} accommodation subtotal`),
    taxTotalMinor: normalizeMinor(snapshot.taxTotalMinor, `${label} tax total`),
    feeTotalMinor: normalizeMinor(snapshot.feeTotalMinor, `${label} fee total`),
    addonTotalMinor: normalizeMinor(snapshot.addonTotalMinor, `${label} add-on total`),
    totalMinor: normalizeMinor(snapshot.totalMinor, `${label} total`),
    pricingFingerprint: normalizeFingerprint(snapshot.pricingFingerprint, `${label} pricing fingerprint`),
  };
  const componentTotal = BigInt(normalized.accommodationSubtotalMinor)
    + BigInt(normalized.taxTotalMinor)
    + BigInt(normalized.feeTotalMinor)
    + BigInt(normalized.addonTotalMinor);
  if (componentTotal !== BigInt(normalized.totalMinor)) {
    throw new Error(`${label} total must equal its monetary components.`);
  }
  return normalized;
}

function signedDifference(after: string, before: string) {
  return (BigInt(after) - BigInt(before)).toString();
}

export function createHospitalityBookingCommercialAdjustmentPreview(input: {
  bookingId: string;
  bookingVersion: string;
  selectionFingerprint: string;
  before: HospitalityBookingCommercialPriceSnapshot;
  after: HospitalityBookingCommercialPriceSnapshot;
}) {
  const bookingId = input.bookingId.trim().toLowerCase();
  if (!bookingId) throw new Error('bookingId is required.');
  const bookingVersion = input.bookingVersion.trim();
  if (!bookingVersion || Number.isNaN(Date.parse(bookingVersion))) {
    throw new Error('bookingVersion must be an ISO-compatible timestamp.');
  }
  const selectionFingerprint = normalizeFingerprint(input.selectionFingerprint, 'selectionFingerprint');
  const before = normalizeSnapshot(input.before, 'Current booking');
  const after = normalizeSnapshot(input.after, 'Proposed booking');
  if (before.currency !== after.currency) {
    throw new Error('Commercial adjustment preview cannot compare different currencies.');
  }

  const deltaMinor = signedDifference(after.totalMinor, before.totalMinor);
  const delta = BigInt(deltaMinor);
  const direction: HospitalityBookingCommercialAdjustmentDirection = delta > 0n
    ? 'ADDITIONAL_CHARGE'
    : delta < 0n
      ? 'REFUND'
      : 'NONE';
  const componentDeltas = {
    accommodationSubtotalMinor: signedDifference(after.accommodationSubtotalMinor, before.accommodationSubtotalMinor),
    taxTotalMinor: signedDifference(after.taxTotalMinor, before.taxTotalMinor),
    feeTotalMinor: signedDifference(after.feeTotalMinor, before.feeTotalMinor),
    addonTotalMinor: signedDifference(after.addonTotalMinor, before.addonTotalMinor),
  };
  const fingerprintPayload = {
    bookingId,
    bookingVersion,
    selectionFingerprint,
    before,
    after,
    deltaMinor,
    componentDeltas,
  };

  return {
    bookingId,
    bookingVersion,
    selectionFingerprint,
    adjustmentFingerprint: createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex'),
    currency: before.currency,
    direction,
    deltaMinor,
    componentDeltas,
    before,
    after,
    requiresPaymentAdjustment: direction !== 'NONE',
    canApplyWithoutPaymentAdjustment: direction === 'NONE',
    inventoryRevalidationRequired: true,
  };
}
