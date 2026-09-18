import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalBookingCommercialAmendmentIdempotencyKey,
  buildRentalBookingCommercialAmendmentReviewFingerprint,
  normalizeRentalBookingCommercialAmendmentPreparationInput,
  rentalBookingCommercialAmendmentDirection,
  rentalBookingCommercialAmendmentExpiresAt,
} from './rental-booking-commercial-amendment-domain.ts';

const baseFingerprintInput = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  bookingId: '22222222-2222-4222-8222-222222222222',
  bookingUpdatedAt: new Date('2026-09-18T08:00:00.000Z'),
  unitId: '33333333-3333-4333-8333-333333333333',
  unitTypeId: '44444444-4444-4444-8444-444444444444',
  locationId: '55555555-5555-4555-8555-555555555555',
  sourceStartsOn: new Date('2026-10-01T00:00:00.000Z'),
  sourceEndsOn: new Date('2026-10-05T00:00:00.000Z'),
  targetStartsOn: new Date('2026-10-02T00:00:00.000Z'),
  targetEndsOn: new Date('2026-10-07T00:00:00.000Z'),
  currency: 'PHP',
  beforeTotalMinor: 10_000n,
  afterTotalMinor: 12_500n,
  sourcePricingFingerprint: 'a'.repeat(64),
  targetPricingFingerprint: 'b'.repeat(64),
  mode: 'PRE_PICKUP_RESCHEDULE' as const,
  pickupEventId: null,
};

test('commercial amendment preparation normalizes reviewed target authority', () => {
  const normalized = normalizeRentalBookingCommercialAmendmentPreparationInput({
    startsOn: '2026-10-02',
    endsOn: '2026-10-07',
    reviewFingerprint: `  ${'C'.repeat(64)}  `,
  });
  assert.equal(normalized.startsOn.toISOString().slice(0, 10), '2026-10-02');
  assert.equal(normalized.endsOn.toISOString().slice(0, 10), '2026-10-07');
  assert.equal(normalized.reviewFingerprint, 'c'.repeat(64));
  assert.throws(() => normalizeRentalBookingCommercialAmendmentPreparationInput({
    startsOn: '2026-10-02',
    endsOn: '2026-10-07',
    reviewFingerprint: undefined,
  }), /fingerprint/i);
  assert.throws(() => normalizeRentalBookingCommercialAmendmentPreparationInput({
    startsOn: 42,
    endsOn: '2026-10-07',
    reviewFingerprint: 'c'.repeat(64),
  }), /target dates/i);
});

test('commercial amendment direction and expiry are exact', () => {
  assert.equal(rentalBookingCommercialAmendmentDirection({ beforeTotalMinor: 10n, afterTotalMinor: 11n }), 'ADDITIONAL_CHARGE');
  assert.equal(rentalBookingCommercialAmendmentDirection({ beforeTotalMinor: 10n, afterTotalMinor: 9n }), 'REFUND');
  assert.throws(() => rentalBookingCommercialAmendmentDirection({ beforeTotalMinor: 10n, afterTotalMinor: 10n }), /non-zero/i);
  const now = new Date('2026-09-18T08:00:00.000Z');
  assert.equal(rentalBookingCommercialAmendmentExpiresAt(now).toISOString(), '2026-09-18T08:15:00.000Z');
});

test('review and idempotency fingerprints bind exact commercial and custody evidence', () => {
  const fingerprint = buildRentalBookingCommercialAmendmentReviewFingerprint(baseFingerprintInput);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(
    buildRentalBookingCommercialAmendmentReviewFingerprint({ ...baseFingerprintInput }),
    fingerprint,
  );
  assert.notEqual(
    buildRentalBookingCommercialAmendmentReviewFingerprint({ ...baseFingerprintInput, afterTotalMinor: 12_501n }),
    fingerprint,
  );
  assert.notEqual(
    buildRentalBookingCommercialAmendmentReviewFingerprint({
      ...baseFingerprintInput,
      mode: 'CUSTODY_EXTENSION',
      targetStartsOn: baseFingerprintInput.sourceStartsOn,
      pickupEventId: '66666666-6666-4666-8666-666666666666',
    }),
    fingerprint,
  );
  const idempotencyKey = buildRentalBookingCommercialAmendmentIdempotencyKey(baseFingerprintInput.bookingId, fingerprint);
  assert.match(idempotencyKey, /^rental-amendment:[a-f0-9]{48}$/);
  assert.equal(buildRentalBookingCommercialAmendmentIdempotencyKey(baseFingerprintInput.bookingId, fingerprint), idempotencyKey);
});
