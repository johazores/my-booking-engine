import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE,
  findActiveHospitalityBookingCommercialAmendment,
} from './hospitality-booking-commercial-amendment-guard.ts';

type GuardReader = Parameters<typeof findActiveHospitalityBookingCommercialAmendment>[0]['reader'];

function fakeReader(findFirst: (args: unknown) => Promise<unknown>): GuardReader {
  return {
    hospitalityBookingCommercialAmendment: { findFirst },
  } as unknown as GuardReader;
}

test('active commercial amendment lookup is tenant, booking, status, and expiry scoped', async () => {
  let captured: unknown;
  const row = {
    id: 'amendment-1',
    direction: 'ADDITIONAL_CHARGE',
    expiresAt: new Date('2026-09-03T03:15:00.000Z'),
  };
  const reader = fakeReader(async (args) => {
    captured = args;
    return row;
  });
  const now = new Date('2026-09-03T03:00:00.000Z');

  const result = await findActiveHospitalityBookingCommercialAmendment({
    reader,
    organizationId: 'organization-1',
    bookingId: 'booking-1',
    now,
  });

  assert.equal(result, row);
  assert.deepEqual(captured, {
    where: {
      organizationId: 'organization-1',
      bookingId: 'booking-1',
      status: 'PREPARED',
      expiresAt: { gt: now },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, direction: true, expiresAt: true },
  });
});

test('active commercial amendment lookup preserves an empty result', async () => {
  const reader = fakeReader(async () => null);

  const result = await findActiveHospitalityBookingCommercialAmendment({
    reader,
    organizationId: 'organization-1',
    bookingId: 'booking-1',
    now: new Date('2026-09-03T03:00:00.000Z'),
  });

  assert.equal(result, null);
});

test('commercial amendment conflict message is safe for booking and payment boundaries', () => {
  assert.match(ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE, /prepared commercial amendment/i);
  assert.doesNotMatch(ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE, /provider|reference|idempotency|tenant/i);
});
