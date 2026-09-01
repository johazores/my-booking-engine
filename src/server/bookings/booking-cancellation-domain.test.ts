import assert from 'node:assert/strict';
import test from 'node:test';

import { bookingCancellationPaymentBlockReason, canCancelBookingWithPaymentState } from './booking-cancellation-domain.ts';

test('booking cancellation only proceeds when payment state is safe to release inventory', () => {
  assert.equal(canCancelBookingWithPaymentState('UNPAID'), true);
  assert.equal(canCancelBookingWithPaymentState('FAILED'), true);
  assert.equal(canCancelBookingWithPaymentState('REFUNDED'), true);
  assert.equal(canCancelBookingWithPaymentState('AUTHORIZED'), false);
  assert.equal(canCancelBookingWithPaymentState('PAID'), false);
  assert.equal(canCancelBookingWithPaymentState('PARTIALLY_REFUNDED'), false);
});

test('booking cancellation explains authorization and refund blockers separately', () => {
  assert.match(bookingCancellationPaymentBlockReason('AUTHORIZED') ?? '', /authorization/i);
  assert.match(bookingCancellationPaymentBlockReason('PAID') ?? '', /refund/i);
  assert.equal(bookingCancellationPaymentBlockReason('REFUNDED'), null);
});
