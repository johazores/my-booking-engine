import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRentalBookingConversionAuthorityFingerprint } from './rental-booking-authority-domain.ts';

const base = Object.freeze({
  organizationId: '00000000-0000-4000-8000-000000000001',
  holdId: '00000000-0000-4000-8000-000000000002',
  customerId: '00000000-0000-4000-8000-000000000003',
  unitId: '00000000-0000-4000-8000-000000000004',
  unitTypeId: '00000000-0000-4000-8000-000000000005',
  locationId: '00000000-0000-4000-8000-000000000006',
  startsOn: new Date('2026-10-01T00:00:00.000Z'),
  endsOn: new Date('2026-10-04T00:00:00.000Z'),
  holdExpiresAt: new Date('2026-09-15T12:00:00.000Z'),
  currency: 'AUD',
  totalMinor: 45_000n,
  pricingFingerprint: 'a'.repeat(64),
});

test('rental booking conversion authority is deterministic', () => {
  const first = buildRentalBookingConversionAuthorityFingerprint(base);
  const second = buildRentalBookingConversionAuthorityFingerprint({ ...base });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('rental booking conversion authority changes with customer, price, or hold expiry', () => {
  const original = buildRentalBookingConversionAuthorityFingerprint(base);
  assert.notEqual(original, buildRentalBookingConversionAuthorityFingerprint({
    ...base,
    customerId: '00000000-0000-4000-8000-000000000007',
  }));
  assert.notEqual(original, buildRentalBookingConversionAuthorityFingerprint({
    ...base,
    totalMinor: 46_000n,
  }));
  assert.notEqual(original, buildRentalBookingConversionAuthorityFingerprint({
    ...base,
    holdExpiresAt: new Date('2026-09-15T12:01:00.000Z'),
  }));
});

test('rental booking conversion authority rejects malformed commercial evidence', () => {
  assert.throws(() => buildRentalBookingConversionAuthorityFingerprint({
    ...base,
    pricingFingerprint: 'not-a-fingerprint',
  }), /fingerprint/i);
  assert.throws(() => buildRentalBookingConversionAuthorityFingerprint({
    ...base,
    totalMinor: 0n,
  }), /positive/i);
  assert.throws(() => buildRentalBookingConversionAuthorityFingerprint({
    ...base,
    endsOn: base.startsOn,
  }), /date range/i);
});
