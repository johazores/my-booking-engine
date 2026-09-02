import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publicBookingPaymentStartDeadline,
  publicBookingPaymentStartWindowIsOpen,
  shouldProtectPendingPublicBookingAllocation,
} from './public-booking-payment-window.ts';

const createdAt = new Date('2026-09-02T10:00:00.000Z');

test('public payment-start deadline is deterministic and exclusive', () => {
  assert.equal(publicBookingPaymentStartDeadline(createdAt).toISOString(), '2026-09-02T10:15:00.000Z');
  assert.equal(publicBookingPaymentStartWindowIsOpen({ ownershipCreatedAt: createdAt, now: new Date('2026-09-02T10:14:59.999Z') }), true);
  assert.equal(publicBookingPaymentStartWindowIsOpen({ ownershipCreatedAt: createdAt, now: new Date('2026-09-02T10:15:00.000Z') }), false);
});

test('pending public allocation stays protected while payment start is recoverable', () => {
  assert.equal(shouldProtectPendingPublicBookingAllocation({
    ownershipCreatedAt: createdAt,
    now: new Date('2026-09-02T10:10:00.000Z'),
  }), true);
  assert.equal(shouldProtectPendingPublicBookingAllocation({
    ownershipCreatedAt: createdAt,
    unresolvedPaymentCreatedAt: new Date('2026-09-02T10:12:00.000Z'),
    now: new Date('2026-09-02T10:20:00.000Z'),
  }), true);
  assert.equal(shouldProtectPendingPublicBookingAllocation({
    ownershipCreatedAt: createdAt,
    openCheckoutExpiresAt: new Date('2026-09-02T10:40:00.000Z'),
    now: new Date('2026-09-02T10:30:00.000Z'),
  }), true);
});

test('stale pre-checkout public allocations age out but successful payment never does', () => {
  assert.equal(shouldProtectPendingPublicBookingAllocation({
    ownershipCreatedAt: createdAt,
    unresolvedPaymentCreatedAt: new Date('2026-09-02T10:02:00.000Z'),
    now: new Date('2026-09-02T10:20:00.000Z'),
  }), false);
  assert.equal(shouldProtectPendingPublicBookingAllocation({
    ownershipCreatedAt: createdAt,
    hasSuccessfulPayment: true,
    now: new Date('2026-09-03T10:00:00.000Z'),
  }), true);
});
