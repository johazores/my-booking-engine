import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalBookingUnitSubstitutionAuthorityFingerprint,
  buildRentalBookingUnitSubstitutionIdempotencyKey,
  normalizeRentalBookingUnitSubstitutionApplyInput,
} from './rental-booking-unit-substitution-domain.ts';

const source = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  bookingId: '22222222-2222-4222-8222-222222222222',
  bookingUpdatedAt: new Date('2026-09-16T00:00:00.000Z'),
  sourceUnitId: '33333333-3333-4333-8333-333333333333',
  targetUnitId: '44444444-4444-4444-8444-444444444444',
  unitTypeId: '55555555-5555-4555-8555-555555555555',
  locationId: '66666666-6666-4666-8666-666666666666',
  startsOn: new Date('2026-10-01T00:00:00.000Z'),
  endsOn: new Date('2026-10-05T00:00:00.000Z'),
  currency: 'PHP',
  totalMinor: 150000n,
  pricingFingerprint: 'a'.repeat(64),
};

test('unit substitution authority changes when operational or commercial evidence changes', () => {
  const fingerprint = buildRentalBookingUnitSubstitutionAuthorityFingerprint(source);
  assert.equal(fingerprint.length, 64);
  assert.notEqual(
    fingerprint,
    buildRentalBookingUnitSubstitutionAuthorityFingerprint({ ...source, targetUnitId: source.sourceUnitId }),
  );
  assert.notEqual(
    fingerprint,
    buildRentalBookingUnitSubstitutionAuthorityFingerprint({
      ...source,
      bookingUpdatedAt: new Date('2026-09-16T00:00:01.000Z'),
    }),
  );
});

test('unit substitution idempotency is deterministic for reviewed authority', () => {
  const fingerprint = buildRentalBookingUnitSubstitutionAuthorityFingerprint(source);
  const key = buildRentalBookingUnitSubstitutionIdempotencyKey(source.bookingId, fingerprint);
  assert.match(key, /^rental-unit-substitution:[a-f0-9]{64}$/);
  assert.equal(key, buildRentalBookingUnitSubstitutionIdempotencyKey(source.bookingId, fingerprint));
});

test('apply input normalizes authority and validates target UUID', () => {
  const result = normalizeRentalBookingUnitSubstitutionApplyInput({
    targetUnitId: ` ${source.targetUnitId} `,
    idempotencyKey: 'rental-unit-substitution:test-key',
    authorityFingerprint: 'B'.repeat(64),
  });
  assert.equal(result.targetUnitId, source.targetUnitId);
  assert.equal(result.authorityFingerprint, 'b'.repeat(64));
});
