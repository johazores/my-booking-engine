import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalBookingUnitSubstitutionAuthorityFingerprint,
  normalizeRentalBookingUnitSubstitutionSearch,
  RentalBookingUnitSubstitutionValidationError,
} from './rental-booking-unit-substitution-domain.ts';

const base = {
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
  totalMinor: 15_000n,
  pricingFingerprint: 'a'.repeat(64),
};

test('unit substitution authority is deterministic for identical durable evidence', () => {
  assert.equal(
    buildRentalBookingUnitSubstitutionAuthorityFingerprint(base),
    buildRentalBookingUnitSubstitutionAuthorityFingerprint({ ...base }),
  );
});

test('unit substitution authority changes with the target physical unit', () => {
  assert.notEqual(
    buildRentalBookingUnitSubstitutionAuthorityFingerprint(base),
    buildRentalBookingUnitSubstitutionAuthorityFingerprint({
      ...base,
      targetUnitId: '77777777-7777-4777-8777-777777777777',
    }),
  );
});

test('unit substitution authority changes with booking version or effective dates', () => {
  const fingerprint = buildRentalBookingUnitSubstitutionAuthorityFingerprint(base);
  assert.notEqual(
    fingerprint,
    buildRentalBookingUnitSubstitutionAuthorityFingerprint({
      ...base,
      bookingUpdatedAt: new Date('2026-09-16T00:00:01.000Z'),
    }),
  );
  assert.notEqual(
    fingerprint,
    buildRentalBookingUnitSubstitutionAuthorityFingerprint({
      ...base,
      endsOn: new Date('2026-10-05T00:00:00.000Z'),
    }),
  );
});

test('unit substitution search and pricing evidence fail closed when malformed', () => {
  assert.equal(normalizeRentalBookingUnitSubstitutionSearch('  van  '), 'van');
  assert.throws(
    () => normalizeRentalBookingUnitSubstitutionSearch('x'.repeat(81)),
    RentalBookingUnitSubstitutionValidationError,
  );
  assert.throws(
    () => buildRentalBookingUnitSubstitutionAuthorityFingerprint({
      ...base,
      pricingFingerprint: 'not-a-fingerprint',
    }),
    RentalBookingUnitSubstitutionValidationError,
  );
});
