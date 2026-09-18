import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RENTAL_BOOKING_CANCELLATION_REASON_MAX_LENGTH,
  RentalBookingCancellationValidationError,
  normalizeRentalBookingCancellationReason,
} from './rental-booking-cancellation-domain.ts';

test('cancellation reason is normalized for durable audit evidence', () => {
  assert.equal(
    normalizeRentalBookingCancellationReason('  customer   changed\nplans  '),
    'customer changed plans',
  );
});

test('cancellation reason is required and bounded', () => {
  assert.throws(
    () => normalizeRentalBookingCancellationReason(' \n\t '),
    RentalBookingCancellationValidationError,
  );
  assert.equal(
    normalizeRentalBookingCancellationReason('a'.repeat(RENTAL_BOOKING_CANCELLATION_REASON_MAX_LENGTH)).length,
    RENTAL_BOOKING_CANCELLATION_REASON_MAX_LENGTH,
  );
  assert.throws(
    () => normalizeRentalBookingCancellationReason('a'.repeat(RENTAL_BOOKING_CANCELLATION_REASON_MAX_LENGTH + 1)),
    RentalBookingCancellationValidationError,
  );
});
