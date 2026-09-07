import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertHospitalitySupplierReservationStoredReviewAcceptance,
  createHospitalitySupplierReservationReviewAcceptance,
} from './hospitality-supplier-reservation-review-acceptance.ts';

const hex = (value: string) => value.repeat(64).slice(0, 64);
const base = {
  id: '7be18ae5-3593-4274-9384-204fe4a770bb',
  status: 'REVIEW_REQUIRED',
  providerCode: 'travelport-stays',
  requestFingerprintVersion: 2,
  rooms: 1,
  reservationPayloadFingerprint: hex('a'),
  currency: 'USD',
  attemptCount: 3,
  lastFailureCode: 'SUPPLIER_PRICE_CHANGED',
  lastFailureRetryable: null,
  providerReservationReference: null,
  supplierConfirmationReference: null,
  providerRecoveryReference: null,
  reviewAcceptedAt: new Date('2026-09-08T00:00:00.000Z'),
  reviewAcceptedByUserId: '2da3c58a-6690-438f-98cf-6559a14b2722',
  reviewAcceptedAttemptSequence: 3,
  reviewAcceptedPriceChange: true,
  reviewAcceptedGuaranteeChange: false,
  reviewAcceptedCurrency: 'USD',
  reviewAcceptedTotalMinor: 10100n,
  reviewAcceptedOfferFingerprint: hex('b'),
  reviewAcceptedTermsFingerprint: hex('c'),
  reviewAcceptedAuthorityFingerprint: hex('d'),
  reviewAcceptanceFingerprint: '',
} as const;

function stored(overrides: Partial<typeof base> = {}) {
  const current = { ...base, ...overrides };
  const acceptance = createHospitalitySupplierReservationReviewAcceptance({
    reservationId: current.id,
    actorUserId: current.reviewAcceptedByUserId,
    reservationPayloadFingerprint: current.reservationPayloadFingerprint,
    attemptSequence: current.reviewAcceptedAttemptSequence,
    failureCode: current.lastFailureCode,
    acceptPriceChange: current.reviewAcceptedPriceChange,
    acceptGuaranteeChange: current.reviewAcceptedGuaranteeChange,
    currency: current.reviewAcceptedCurrency,
    acceptedTotalMinor: current.reviewAcceptedTotalMinor,
    acceptedOfferFingerprint: current.reviewAcceptedOfferFingerprint,
    acceptedTermsFingerprint: current.reviewAcceptedTermsFingerprint,
    acceptedAuthorityFingerprint: current.reviewAcceptedAuthorityFingerprint,
  });
  return { ...current, reviewAcceptanceFingerprint: acceptance.acceptanceFingerprint };
}

test('reconstructs an exact current accepted review before future consumption', () => {
  const result = assertHospitalitySupplierReservationStoredReviewAcceptance(stored());
  assert.equal(result.reviewAttemptSequence, 3);
  assert.equal(result.acceptance.acceptPriceChange, true);
  assert.equal(result.acceptance.acceptGuaranteeChange, false);
  assert.equal(result.acceptance.acceptedTotalMinor, 10100n);
});

test('rejects a tampered durable acceptance fingerprint', () => {
  assert.throws(
    () => assertHospitalitySupplierReservationStoredReviewAcceptance({
      ...stored(),
      reviewAcceptanceFingerprint: hex('f'),
    }),
    /no longer matches its durable acceptance authority/,
  );
});

test('rejects an acceptance attached to a stale review attempt', () => {
  assert.throws(
    () => assertHospitalitySupplierReservationStoredReviewAcceptance({
      ...stored(),
      attemptCount: 4,
    }),
    /identity is incomplete or stale/,
  );
});

test('rejects accepted review evidence outside the terminal review state', () => {
  assert.throws(
    () => assertHospitalitySupplierReservationStoredReviewAcceptance({
      ...stored(),
      status: 'FAILED',
    }),
    /not in a consumable Travelport review state/,
  );
});
