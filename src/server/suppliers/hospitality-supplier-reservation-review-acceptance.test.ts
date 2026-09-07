import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertHospitalitySupplierReservationStoredReviewAcceptance,
  createHospitalitySupplierReservationReviewAcceptance,
  hospitalitySupplierReservationReviewAcceptanceRequirements,
} from './hospitality-supplier-reservation-review-acceptance.ts';

const fingerprint = 'a'.repeat(64);

test('review reasons require only the exact applicable Travelport acceptance decisions', () => {
  assert.deepEqual(hospitalitySupplierReservationReviewAcceptanceRequirements('SUPPLIER_PRICE_CHANGED'), {
    reason: 'SUPPLIER_PRICE_CHANGED',
    acceptPriceChange: true,
    acceptGuaranteeChange: false,
  });
  assert.deepEqual(hospitalitySupplierReservationReviewAcceptanceRequirements('SUPPLIER_GUARANTEE_CHANGED'), {
    reason: 'SUPPLIER_GUARANTEE_CHANGED',
    acceptPriceChange: false,
    acceptGuaranteeChange: true,
  });
  assert.deepEqual(hospitalitySupplierReservationReviewAcceptanceRequirements('SUPPLIER_PRICE_AND_GUARANTEE_CHANGED'), {
    reason: 'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED',
    acceptPriceChange: true,
    acceptGuaranteeChange: true,
  });
  assert.throws(
    () => hospitalitySupplierReservationReviewAcceptanceRequirements('INVALID_RESPONSE'),
    /not waiting for a recognized price or guarantee review decision/,
  );
});

test('acceptance fingerprint binds actor, commercial authority, and traveler authority exactly', () => {
  const base = {
    reservationId: 'b4799920-b6d0-4dfc-b95c-74cac80ae31b',
    actorUserId: '97bb07d8-37c7-47c5-94f8-8ecf11fe7bb1',
    reservationPayloadFingerprint: 'b'.repeat(64),
    attemptSequence: 2,
    failureCode: 'SUPPLIER_PRICE_CHANGED',
    acceptPriceChange: true,
    acceptGuaranteeChange: false,
    currency: 'AUD',
    acceptedTotalMinor: 14500n,
    acceptedOfferFingerprint: fingerprint,
    acceptedTermsFingerprint: 'c'.repeat(64),
    acceptedAuthorityFingerprint: 'd'.repeat(64),
  } as const;
  const accepted = createHospitalitySupplierReservationReviewAcceptance(base);
  assert.match(accepted.acceptanceFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(
    createHospitalitySupplierReservationReviewAcceptance(base).acceptanceFingerprint,
    accepted.acceptanceFingerprint,
  );
  assert.notEqual(
    createHospitalitySupplierReservationReviewAcceptance({ ...base, acceptedTotalMinor: 14501n }).acceptanceFingerprint,
    accepted.acceptanceFingerprint,
  );
  assert.notEqual(
    createHospitalitySupplierReservationReviewAcceptance({ ...base, actorUserId: '022bb174-4cb4-4680-b641-605f002ca3c7' }).acceptanceFingerprint,
    accepted.acceptanceFingerprint,
  );
});

test('partial, excessive, or malformed review acceptance fails closed', () => {
  const base = {
    reservationId: 'b4799920-b6d0-4dfc-b95c-74cac80ae31b',
    actorUserId: '97bb07d8-37c7-47c5-94f8-8ecf11fe7bb1',
    reservationPayloadFingerprint: 'b'.repeat(64),
    attemptSequence: 2,
    failureCode: 'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED',
    currency: 'AUD',
    acceptedTotalMinor: 14500n,
    acceptedOfferFingerprint: fingerprint,
    acceptedTermsFingerprint: 'c'.repeat(64),
    acceptedAuthorityFingerprint: 'd'.repeat(64),
  } as const;
  assert.throws(
    () => createHospitalitySupplierReservationReviewAcceptance({
      ...base,
      acceptPriceChange: true,
      acceptGuaranteeChange: false,
    }),
    /explicitly match/,
  );
  assert.throws(
    () => createHospitalitySupplierReservationReviewAcceptance({
      ...base,
      acceptPriceChange: true,
      acceptGuaranteeChange: true,
      acceptedAuthorityFingerprint: 'bad',
    }),
    /availability authority fingerprint is invalid/,
  );
});

const storedBase = {
  id: '7be18ae5-3593-4274-9384-204fe4a770bb',
  status: 'REVIEW_REQUIRED',
  providerCode: 'travelport-stays',
  requestFingerprintVersion: 2,
  rooms: 1,
  reservationPayloadFingerprint: 'e'.repeat(64),
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
  reviewAcceptedOfferFingerprint: 'f'.repeat(64),
  reviewAcceptedTermsFingerprint: '1'.repeat(64),
  reviewAcceptedAuthorityFingerprint: '2'.repeat(64),
  reviewAcceptanceFingerprint: '',
} as const;

function stored(overrides: Partial<typeof storedBase> = {}) {
  const current = { ...storedBase, ...overrides };
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
      reviewAcceptanceFingerprint: '3'.repeat(64),
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
