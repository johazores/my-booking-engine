import { createHash } from 'node:crypto';

import { HospitalitySupplierReservationConflictError } from './hospitality-supplier-reservation-domain.ts';

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_TOTAL_MINOR = 9_000_000_000_000_000n;

export type HospitalitySupplierReservationReviewReason =
  | 'SUPPLIER_PRICE_CHANGED'
  | 'SUPPLIER_GUARANTEE_CHANGED'
  | 'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED';

export type HospitalitySupplierReservationReviewAcceptance = Readonly<{
  reason: HospitalitySupplierReservationReviewReason;
  acceptPriceChange: boolean;
  acceptGuaranteeChange: boolean;
  currency: string;
  acceptedTotalMinor: bigint;
  acceptedOfferFingerprint: string;
  acceptedTermsFingerprint: string;
  acceptedAuthorityFingerprint: string;
  acceptanceFingerprint: string;
}>;

export type HospitalitySupplierReservationStoredReviewAcceptance = Readonly<{
  acceptedAt: Date;
  acceptedByUserId: string;
  reviewAttemptSequence: number;
  acceptance: HospitalitySupplierReservationReviewAcceptance;
}>;

export function hospitalitySupplierReservationReviewAcceptanceRequirements(
  failureCode: unknown,
): Readonly<{ reason: HospitalitySupplierReservationReviewReason; acceptPriceChange: boolean; acceptGuaranteeChange: boolean }> {
  if (failureCode === 'SUPPLIER_PRICE_CHANGED') {
    return Object.freeze({ reason: failureCode, acceptPriceChange: true, acceptGuaranteeChange: false });
  }
  if (failureCode === 'SUPPLIER_GUARANTEE_CHANGED') {
    return Object.freeze({ reason: failureCode, acceptPriceChange: false, acceptGuaranteeChange: true });
  }
  if (failureCode === 'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED') {
    return Object.freeze({ reason: failureCode, acceptPriceChange: true, acceptGuaranteeChange: true });
  }
  throw new HospitalitySupplierReservationConflictError(
    'Supplier reservation is not waiting for a recognized price or guarantee review decision.',
  );
}

function fingerprint(value: unknown, label: string) {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
    throw new HospitalitySupplierReservationConflictError(`${label} is invalid.`);
  }
  return value;
}

export function createHospitalitySupplierReservationReviewAcceptance(input: Readonly<{
  reservationId: string;
  actorUserId: string;
  reservationPayloadFingerprint: string;
  attemptSequence: number;
  failureCode: unknown;
  acceptPriceChange: unknown;
  acceptGuaranteeChange: unknown;
  currency: unknown;
  acceptedTotalMinor: unknown;
  acceptedOfferFingerprint: unknown;
  acceptedTermsFingerprint: unknown;
  acceptedAuthorityFingerprint: unknown;
}>): HospitalitySupplierReservationReviewAcceptance {
  const requirements = hospitalitySupplierReservationReviewAcceptanceRequirements(input.failureCode);
  if (
    input.acceptPriceChange !== requirements.acceptPriceChange
    || input.acceptGuaranteeChange !== requirements.acceptGuaranteeChange
  ) {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier reservation review acceptance must explicitly match the pending commercial change.',
    );
  }
  if (typeof input.reservationId !== 'string' || !input.reservationId.trim() || /[\r\n]/.test(input.reservationId)) {
    throw new HospitalitySupplierReservationConflictError('Supplier reservation review identity is invalid.');
  }
  if (typeof input.actorUserId !== 'string' || !input.actorUserId.trim() || /[\r\n]/.test(input.actorUserId)) {
    throw new HospitalitySupplierReservationConflictError('Supplier reservation review actor is invalid.');
  }
  if (!Number.isSafeInteger(input.attemptSequence) || (input.attemptSequence as number) < 1) {
    throw new HospitalitySupplierReservationConflictError('Supplier reservation review attempt is invalid.');
  }
  const reservationPayloadFingerprint = fingerprint(
    input.reservationPayloadFingerprint,
    'Supplier reservation traveler authority',
  );
  if (typeof input.currency !== 'string' || !CURRENCY_PATTERN.test(input.currency)) {
    throw new HospitalitySupplierReservationConflictError('Supplier reservation review currency is invalid.');
  }
  if (
    typeof input.acceptedTotalMinor !== 'bigint'
    || input.acceptedTotalMinor < 0n
    || input.acceptedTotalMinor > MAX_TOTAL_MINOR
  ) {
    throw new HospitalitySupplierReservationConflictError('Supplier reservation accepted total is invalid.');
  }

  const acceptedOfferFingerprint = fingerprint(input.acceptedOfferFingerprint, 'Accepted supplier offer fingerprint');
  const acceptedTermsFingerprint = fingerprint(input.acceptedTermsFingerprint, 'Accepted supplier terms fingerprint');
  const acceptedAuthorityFingerprint = fingerprint(
    input.acceptedAuthorityFingerprint,
    'Accepted supplier availability authority fingerprint',
  );
  const acceptanceFingerprint = createHash('sha256').update([
    'sf:supplier-reservation-review-acceptance:v1',
    input.reservationId,
    input.actorUserId,
    String(input.attemptSequence),
    requirements.reason,
    requirements.acceptPriceChange ? '1' : '0',
    requirements.acceptGuaranteeChange ? '1' : '0',
    input.currency,
    input.acceptedTotalMinor.toString(),
    acceptedOfferFingerprint,
    acceptedTermsFingerprint,
    acceptedAuthorityFingerprint,
    reservationPayloadFingerprint,
  ].join('\u001f'), 'utf8').digest('hex');

  return Object.freeze({
    reason: requirements.reason,
    acceptPriceChange: requirements.acceptPriceChange,
    acceptGuaranteeChange: requirements.acceptGuaranteeChange,
    currency: input.currency,
    acceptedTotalMinor: input.acceptedTotalMinor,
    acceptedOfferFingerprint,
    acceptedTermsFingerprint,
    acceptedAuthorityFingerprint,
    acceptanceFingerprint,
  });
}

/**
 * Rebuild the current durable review decision from bounded operation fields before any future
 * one-time consumption path is allowed to rely on it. This is deliberately provider-neutral:
 * provider freshness still has to be re-established by the Travelport adapter immediately before
 * the second write is claimed.
 */
export function assertHospitalitySupplierReservationStoredReviewAcceptance(input: Readonly<{
  id: string;
  status: string;
  providerCode: string;
  requestFingerprintVersion: number | null;
  rooms: number;
  reservationPayloadFingerprint: string;
  currency: string;
  attemptCount: number;
  lastFailureCode: string | null;
  lastFailureRetryable: boolean | null;
  providerReservationReference: string | null;
  supplierConfirmationReference: string | null;
  providerRecoveryReference: string | null;
  reviewAcceptedAt: Date | null;
  reviewAcceptedByUserId: string | null;
  reviewAcceptedAttemptSequence: number | null;
  reviewAcceptedPriceChange: boolean | null;
  reviewAcceptedGuaranteeChange: boolean | null;
  reviewAcceptedCurrency: string | null;
  reviewAcceptedTotalMinor: bigint | null;
  reviewAcceptedOfferFingerprint: string | null;
  reviewAcceptedTermsFingerprint: string | null;
  reviewAcceptedAuthorityFingerprint: string | null;
  reviewAcceptanceFingerprint: string | null;
}>): HospitalitySupplierReservationStoredReviewAcceptance {
  if (
    input.status !== 'REVIEW_REQUIRED'
    || input.providerCode !== 'travelport-stays'
    || input.requestFingerprintVersion !== 2
    || input.rooms !== 1
    || input.lastFailureRetryable !== null
    || input.providerReservationReference !== null
    || input.supplierConfirmationReference !== null
    || input.providerRecoveryReference !== null
  ) {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier reservation accepted review is not in a consumable Travelport review state.',
    );
  }
  if (
    !(input.reviewAcceptedAt instanceof Date)
    || !Number.isFinite(input.reviewAcceptedAt.getTime())
    || typeof input.reviewAcceptedByUserId !== 'string'
    || !input.reviewAcceptedByUserId.trim()
    || /[\r\n]/.test(input.reviewAcceptedByUserId)
    || !Number.isSafeInteger(input.reviewAcceptedAttemptSequence)
    || input.reviewAcceptedAttemptSequence !== input.attemptCount
  ) {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier reservation accepted review identity is incomplete or stale.',
    );
  }

  const acceptance = createHospitalitySupplierReservationReviewAcceptance({
    reservationId: input.id,
    actorUserId: input.reviewAcceptedByUserId,
    reservationPayloadFingerprint: input.reservationPayloadFingerprint,
    attemptSequence: input.reviewAcceptedAttemptSequence,
    failureCode: input.lastFailureCode,
    acceptPriceChange: input.reviewAcceptedPriceChange,
    acceptGuaranteeChange: input.reviewAcceptedGuaranteeChange,
    currency: input.reviewAcceptedCurrency,
    acceptedTotalMinor: input.reviewAcceptedTotalMinor,
    acceptedOfferFingerprint: input.reviewAcceptedOfferFingerprint,
    acceptedTermsFingerprint: input.reviewAcceptedTermsFingerprint,
    acceptedAuthorityFingerprint: input.reviewAcceptedAuthorityFingerprint,
  });

  if (
    input.reviewAcceptedCurrency !== input.currency
    || input.reviewAcceptanceFingerprint !== acceptance.acceptanceFingerprint
  ) {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier reservation accepted review no longer matches its durable acceptance authority.',
    );
  }

  return Object.freeze({
    acceptedAt: new Date(input.reviewAcceptedAt.getTime()),
    acceptedByUserId: input.reviewAcceptedByUserId,
    reviewAttemptSequence: input.reviewAcceptedAttemptSequence,
    acceptance,
  });
}
