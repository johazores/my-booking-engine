import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalBookingUnitSubstitutionAuthorityFingerprint,
  buildRentalBookingUnitSubstitutionIdempotencyKey,
  normalizeRentalBookingUnitSubstitutionApplyInput,
  RentalBookingUnitSubstitutionValidationError,
} from './rental-booking-unit-substitution-domain.ts';

const fingerprint = 'a'.repeat(64);

function authority(overrides: Partial<Parameters<typeof buildRentalBookingUnitSubstitutionAuthorityFingerprint>[0]> = {}) {
  return buildRentalBookingUnitSubstitutionAuthorityFingerprint({
    organizationId: '11111111-1111-4111-8111-111111111111',
    bookingId: '22222222-2222-4222-8222-222222222222',
    bookingUpdatedAt: new Date('2026-09-16T00:00:00.000Z'),
    sourceUnitId: '33333333-3333-4333-8333-333333333333',
    targetUnitId: '44444444-4444-4444-8444-444444444444',
    unitTypeId: '55555555-5555-4555-8555-555555555555',
    locationId: '66666666-6666-4666-8666-666666666666',
    startsOn: new Date('2026-10-01T00:00:00.000Z'),
    endsOn: new Date('2026-10-04T00:00:00.000Z'),
    currency: 'PHP',
    totalMinor: 12345n,
    pricingFingerprint: fingerprint,
    ...overrides,
  });
}

test('unit substitution authority changes when current source or target inventory changes', () => {
  const baseline = authority();
  assert.notEqual(baseline, authority({ sourceUnitId: '77777777-7777-4777-8777-777777777777' }));
  assert.notEqual(baseline, authority({ targetUnitId: '88888888-8888-4888-8888-888888888888' }));
  assert.notEqual(baseline, authority({ bookingUpdatedAt: new Date('2026-09-16T00:00:01.000Z') }));
});

test('unit substitution idempotency derives from booking target and reviewed authority', () => {
  const first = buildRentalBookingUnitSubstitutionIdempotencyKey('booking-a', 'unit-b', fingerprint);
  assert.equal(first, buildRentalBookingUnitSubstitutionIdempotencyKey('booking-a', 'unit-b', fingerprint));
  assert.notEqual(first, buildRentalBookingUnitSubstitutionIdempotencyKey('booking-a', 'unit-c', fingerprint));
  assert.match(first, /^rental-unit-substitution:[a-f0-9]{64}$/);
});

test('unit substitution apply input normalizes identifiers and fails closed on invalid authority', () => {
  const normalized = normalizeRentalBookingUnitSubstitutionApplyInput({
    targetUnitId: '44444444-4444-4444-8444-444444444444',
    idempotencyKey: 'rental-unit-substitution:test-key',
    authorityFingerprint: fingerprint.toUpperCase(),
  });
  assert.equal(normalized.targetUnitId, '44444444-4444-4444-8444-444444444444');
  assert.equal(normalized.authorityFingerprint, fingerprint);
  assert.throws(
    () => normalizeRentalBookingUnitSubstitutionApplyInput({
      targetUnitId: normalized.targetUnitId,
      idempotencyKey: normalized.idempotencyKey,
      authorityFingerprint: 'not-authority',
    }),
    RentalBookingUnitSubstitutionValidationError,
  );
});
