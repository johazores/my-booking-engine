import assert from 'node:assert/strict';
import test from 'node:test';

import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';

test('booking mutation lock matches the established payment booking lock namespace', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const bookingId = '22222222-2222-4222-8222-222222222222';

  assert.equal(
    hospitalityBookingMutationLockKey({ organizationId, bookingId }),
    `payment:${organizationId}:booking:${bookingId}`,
  );
  assert.notEqual(
    hospitalityBookingMutationLockKey({ organizationId, bookingId }),
    hospitalityBookingMutationLockKey({ organizationId, bookingId: '33333333-3333-4333-8333-333333333333' }),
  );
});
