import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalBookingRescheduleAuthorityFingerprint,
  normalizeRentalBookingRescheduleReviewInput,
} from './rental-booking-reschedule-domain.ts';

const baseFingerprintInput = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  bookingId: '22222222-2222-4222-8222-222222222222',
  bookingUpdatedAt: new Date('2026-09-15T12:00:00.000Z'),
  unitId: '33333333-3333-4333-8333-333333333333',
  unitTypeId: '44444444-4444-4444-8444-444444444444',
  locationId: '55555555-5555-4555-8555-555555555555',
  startsOn: new Date('2026-10-10T00:00:00.000Z'),
  endsOn: new Date('2026-10-13T00:00:00.000Z'),
  currency: 'PHP',
  totalMinor: 900000n,
  sourcePricingFingerprint: 'a'.repeat(64),
  targetPricingFingerprint: 'b'.repeat(64),
};

test('normalizes a bounded exclusive-end reschedule date range', () => {
  const normalized = normalizeRentalBookingRescheduleReviewInput({ startsOn: '2026-10-10', endsOn: '2026-10-13' });
  assert.equal(normalized.days, 3);
  assert.equal(normalized.startsOn.toISOString(), '2026-10-10T00:00:00.000Z');
  assert.equal(normalized.endsOn.toISOString(), '2026-10-13T00:00:00.000Z');
});

test('rejects reschedule reviews beyond the pricing horizon', () => {
  assert.throws(
    () => normalizeRentalBookingRescheduleReviewInput({ startsOn: '2026-10-01', endsOn: '2027-02-01' }),
    /cannot exceed 90 days/,
  );
});

test('authority fingerprint is deterministic and binds target pricing/date evidence', () => {
  const first = buildRentalBookingRescheduleAuthorityFingerprint(baseFingerprintInput);
  const replay = buildRentalBookingRescheduleAuthorityFingerprint(baseFingerprintInput);
  const changedDate = buildRentalBookingRescheduleAuthorityFingerprint({
    ...baseFingerprintInput,
    endsOn: new Date('2026-10-14T00:00:00.000Z'),
  });
  const changedPricing = buildRentalBookingRescheduleAuthorityFingerprint({
    ...baseFingerprintInput,
    targetPricingFingerprint: 'c'.repeat(64),
  });
  assert.equal(first, replay);
  assert.notEqual(first, changedDate);
  assert.notEqual(first, changedPricing);
  assert.match(first, /^[a-f0-9]{64}$/);
});
