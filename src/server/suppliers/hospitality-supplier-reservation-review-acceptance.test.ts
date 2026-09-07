import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
