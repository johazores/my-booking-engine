import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveRentalBookingEarlyReturnReleaseEndsOn,
  rentalBookingEarlyReturnReleaseIdempotencyKey,
} from './rental-booking-early-return-release-domain.ts';

test('early-return release frees only whole rental days after the return day', () => {
  const releasedEndsOn = deriveRentalBookingEarlyReturnReleaseEndsOn({
    returnedAt: new Date('2026-10-12T08:30:00.000Z'),
    committedStartsOn: new Date('2026-10-10T00:00:00.000Z'),
    committedEndsOn: new Date('2026-10-16T00:00:00.000Z'),
    timeZone: 'Australia/Sydney',
  });
  assert.equal(releasedEndsOn?.toISOString(), '2026-10-13T00:00:00.000Z');
});

test('early-return release uses the retained booking location calendar day', () => {
  const returnedAt = new Date('2026-09-16T00:30:00.000Z');
  assert.equal(
    deriveRentalBookingEarlyReturnReleaseEndsOn({
      returnedAt,
      committedStartsOn: new Date('2026-09-14T00:00:00.000Z'),
      committedEndsOn: new Date('2026-09-20T00:00:00.000Z'),
      timeZone: 'America/Los_Angeles',
    })?.toISOString(),
    '2026-09-16T00:00:00.000Z',
  );
});

test('early-return release preserves at least the first committed rental day and rejects no-op release', () => {
  assert.equal(
    deriveRentalBookingEarlyReturnReleaseEndsOn({
      returnedAt: new Date('2026-10-09T10:00:00.000Z'),
      committedStartsOn: new Date('2026-10-10T00:00:00.000Z'),
      committedEndsOn: new Date('2026-10-12T00:00:00.000Z'),
      timeZone: 'UTC',
    })?.toISOString(),
    '2026-10-11T00:00:00.000Z',
  );

  assert.equal(
    deriveRentalBookingEarlyReturnReleaseEndsOn({
      returnedAt: new Date('2026-10-11T10:00:00.000Z'),
      committedStartsOn: new Date('2026-10-10T00:00:00.000Z'),
      committedEndsOn: new Date('2026-10-12T00:00:00.000Z'),
      timeZone: 'UTC',
    }),
    null,
  );
});

test('early-return release idempotency key is server deterministic', () => {
  const bookingId = '00000000-0000-4000-8000-000000000001';
  assert.equal(
    rentalBookingEarlyReturnReleaseIdempotencyKey(bookingId),
    `rental-early-return-release:${bookingId}`,
  );
});
