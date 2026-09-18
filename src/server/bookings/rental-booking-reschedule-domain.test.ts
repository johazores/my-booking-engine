import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalBookingRescheduleAuthorityFingerprint,
  buildRentalBookingRescheduleCommercialImpact,
  isRentalBookingCustodyExtensionTarget,
  RentalBookingRescheduleValidationError,
} from './rental-booking-reschedule-domain.ts';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

test('picked-up rental extension keeps the current start and moves only the end later', () => {
  assert.equal(isRentalBookingCustodyExtensionTarget({
    sourceStartsOn: date('2026-09-10'),
    sourceEndsOn: date('2026-09-15'),
    targetStartsOn: date('2026-09-10'),
    targetEndsOn: date('2026-09-17'),
  }), true);

  assert.equal(isRentalBookingCustodyExtensionTarget({
    sourceStartsOn: date('2026-09-10'),
    sourceEndsOn: date('2026-09-15'),
    targetStartsOn: date('2026-09-11'),
    targetEndsOn: date('2026-09-17'),
  }), false);

  assert.equal(isRentalBookingCustodyExtensionTarget({
    sourceStartsOn: date('2026-09-10'),
    sourceEndsOn: date('2026-09-15'),
    targetStartsOn: date('2026-09-10'),
    targetEndsOn: date('2026-09-15'),
  }), false);
});

test('reschedule review derives exact same-currency commercial impact without browser authority', () => {
  const unchanged = buildRentalBookingRescheduleCommercialImpact({
    acceptedCurrency: 'aud',
    acceptedTotalMinor: 50_000n,
    targetCurrency: 'AUD',
    targetTotalMinor: 50_000n,
  });
  assert.deepEqual(unchanged, {
    kind: 'UNCHANGED',
    acceptedCurrency: 'AUD',
    acceptedTotalMinor: 50_000n,
    targetCurrency: 'AUD',
    targetTotalMinor: 50_000n,
    deltaMinor: 0n,
  });

  const increase = buildRentalBookingRescheduleCommercialImpact({
    acceptedCurrency: 'AUD',
    acceptedTotalMinor: 50_000n,
    targetCurrency: 'AUD',
    targetTotalMinor: 62_500n,
  });
  assert.equal(increase.kind, 'INCREASE');
  assert.equal(increase.deltaMinor, 12_500n);

  const decrease = buildRentalBookingRescheduleCommercialImpact({
    acceptedCurrency: 'AUD',
    acceptedTotalMinor: 50_000n,
    targetCurrency: 'AUD',
    targetTotalMinor: 41_000n,
  });
  assert.equal(decrease.kind, 'DECREASE');
  assert.equal(decrease.deltaMinor, 9_000n);
});

test('reschedule review separates currency drift from a same-currency price amendment', () => {
  const impact = buildRentalBookingRescheduleCommercialImpact({
    acceptedCurrency: 'AUD',
    acceptedTotalMinor: 50_000n,
    targetCurrency: 'USD',
    targetTotalMinor: 50_000n,
  });
  assert.equal(impact.kind, 'CURRENCY_CHANGED');
  assert.equal(impact.deltaMinor, null);

  assert.throws(() => buildRentalBookingRescheduleCommercialImpact({
    acceptedCurrency: 'AU',
    acceptedTotalMinor: 50_000n,
    targetCurrency: 'AUD',
    targetTotalMinor: 50_000n,
  }), RentalBookingRescheduleValidationError);
  assert.throws(() => buildRentalBookingRescheduleCommercialImpact({
    acceptedCurrency: 'AUD',
    acceptedTotalMinor: -1n,
    targetCurrency: 'AUD',
    targetTotalMinor: 0n,
  }), RentalBookingRescheduleValidationError);
});

test('reschedule authority fingerprint changes across the pickup custody boundary', () => {
  const common = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    bookingId: '22222222-2222-4222-8222-222222222222',
    bookingUpdatedAt: new Date('2026-09-10T01:00:00.000Z'),
    unitId: '33333333-3333-4333-8333-333333333333',
    unitTypeId: '44444444-4444-4444-8444-444444444444',
    locationId: '55555555-5555-4555-8555-555555555555',
    sourceStartsOn: date('2026-09-10'),
    sourceEndsOn: date('2026-09-15'),
    targetStartsOn: date('2026-09-10'),
    targetEndsOn: date('2026-09-17'),
    currency: 'AUD',
    totalMinor: 50000n,
    sourcePricingFingerprint: 'a'.repeat(64),
    targetPricingFingerprint: 'b'.repeat(64),
  };

  const prePickup = buildRentalBookingRescheduleAuthorityFingerprint({
    ...common,
    mode: 'PRE_PICKUP_RESCHEDULE',
    pickupEventId: null,
  });
  const inCustody = buildRentalBookingRescheduleAuthorityFingerprint({
    ...common,
    mode: 'CUSTODY_EXTENSION',
    pickupEventId: '66666666-6666-4666-8666-666666666666',
  });

  assert.match(prePickup, /^[a-f0-9]{64}$/);
  assert.match(inCustody, /^[a-f0-9]{64}$/);
  assert.notEqual(prePickup, inCustody);
});
