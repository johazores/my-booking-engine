import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RENTAL_BOOKING_CANCELLATION_REASON_MAX_LENGTH,
  RentalBookingCancellationValidationError,
  classifyRentalBookingCancellationReplayEvidence,
  normalizeRentalBookingCancellationReason,
} from './rental-booking-cancellation-domain.ts';

test('cancellation reason is normalized for durable audit evidence', () => {
  assert.equal(
    normalizeRentalBookingCancellationReason('  customer   changed\nplans  '),
    'customer changed plans',
  );
});

test('cancellation reason is required and bounded', () => {
  for (const value of [undefined, null, 42, false, {}, [], ' \n\t ']) {
    assert.throws(
      () => normalizeRentalBookingCancellationReason(value),
      RentalBookingCancellationValidationError,
    );
  }
  assert.equal(
    normalizeRentalBookingCancellationReason('a'.repeat(RENTAL_BOOKING_CANCELLATION_REASON_MAX_LENGTH)).length,
    RENTAL_BOOKING_CANCELLATION_REASON_MAX_LENGTH,
  );
  assert.throws(
    () => normalizeRentalBookingCancellationReason('a'.repeat(RENTAL_BOOKING_CANCELLATION_REASON_MAX_LENGTH + 1)),
    RentalBookingCancellationValidationError,
  );
});

test('cancellation replay requires the exact retained terminal audit evidence', () => {
  const afterData = {
    status: 'CANCELLED',
    cancelledAt: '2026-09-18T03:36:58.000Z',
    cancellationReason: 'Customer changed plans',
    allocationId: 'allocation-1',
    inventoryProtectionReleased: true,
  };

  assert.equal(
    classifyRentalBookingCancellationReplayEvidence({
      afterData,
      cancellationReason: 'Customer changed plans',
      cancelledAt: afterData.cancelledAt,
      allocationId: afterData.allocationId,
    }),
    'MATCH',
  );
  assert.equal(
    classifyRentalBookingCancellationReplayEvidence({
      afterData,
      cancellationReason: 'Different reason',
      cancelledAt: afterData.cancelledAt,
      allocationId: afterData.allocationId,
    }),
    'REASON_MISMATCH',
  );

  for (const invalidAfterData of [
    null,
    [],
    { ...afterData, status: 'CONFIRMED' },
    { ...afterData, cancelledAt: '2026-09-18T03:36:59.000Z' },
    { ...afterData, allocationId: 'allocation-2' },
    { ...afterData, inventoryProtectionReleased: false },
    { ...afterData, cancellationReason: '  Customer changed plans  ' },
  ]) {
    assert.equal(
      classifyRentalBookingCancellationReplayEvidence({
        afterData: invalidAfterData,
        cancellationReason: 'Customer changed plans',
        cancelledAt: afterData.cancelledAt,
        allocationId: afterData.allocationId,
      }),
      'EVIDENCE_MISMATCH',
    );
  }
});
