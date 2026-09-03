import assert from 'node:assert/strict';
import test from 'node:test';

import { createHospitalityBookingCommercialAdjustmentPreview } from './booking-commercial-adjustment-domain.ts';
import {
  assertHospitalityCommercialAmendmentApplyConsistency,
  HospitalityCommercialAmendmentApplyConsistencyError,
} from './booking-commercial-amendment-apply-domain.ts';

const fingerprint = (digit: string) => digit.repeat(64);
const addons = [{ addonId: '11111111-1111-4111-8111-111111111111', quantity: 1 }] as const;
const before = {
  currency: 'USD',
  accommodationSubtotalMinor: '10000',
  taxTotalMinor: '1000',
  feeTotalMinor: '500',
  addonTotalMinor: '500',
  totalMinor: '12000',
  pricingFingerprint: fingerprint('a'),
};
const after = {
  currency: 'USD',
  accommodationSubtotalMinor: '12500',
  taxTotalMinor: '1200',
  feeTotalMinor: '500',
  addonTotalMinor: '800',
  totalMinor: '15000',
  pricingFingerprint: fingerprint('b'),
};
const bookingVersion = '2026-09-03T00:00:00.000Z';
const selectionFingerprint = fingerprint('c');
const preview = createHospitalityBookingCommercialAdjustmentPreview({
  bookingId: 'booking-1',
  bookingVersion,
  selectionFingerprint,
  before,
  after,
});

function validInput() {
  return {
    bookingId: 'booking-1',
    booking: {
      updatedAt: bookingVersion,
      roomTypeId: 'room-a',
      ratePlanId: 'rate-a',
      quantity: 1,
      addonSelections: addons,
      price: before,
    },
    amendment: {
      bookingVersion,
      currentRoomTypeId: 'room-a',
      currentRatePlanId: 'rate-a',
      currentQuantity: 1,
      currentAddonSelections: addons,
      targetRoomTypeId: 'room-b',
      targetRatePlanId: 'rate-b',
      targetQuantity: 1,
      targetAddonSelections: addons,
      selectionFingerprint,
      adjustmentFingerprint: preview.adjustmentFingerprint,
      direction: 'ADDITIONAL_CHARGE' as const,
      deltaMinor: '3000',
      before,
      after,
      protectionQuantity: 1,
      targetHoldId: 'hold-1',
    },
    freshTargetPrice: after,
    targetSelectionFingerprint: selectionFingerprint,
    expectedProtectionQuantity: 1,
  };
}

function assertReason(run: () => unknown, reason: HospitalityCommercialAmendmentApplyConsistencyError['reason']) {
  assert.throws(run, (error) => (
    error instanceof HospitalityCommercialAmendmentApplyConsistencyError
    && error.reason === reason
  ));
}

test('accepts unchanged prepared amendment state', () => {
  assert.equal(assertHospitalityCommercialAmendmentApplyConsistency(validInput()).deltaMinor, '3000');
});

test('rejects booking version drift', () => {
  const input = validInput();
  input.booking.updatedAt = '2026-09-03T00:01:00.000Z';
  assertReason(() => assertHospitalityCommercialAmendmentApplyConsistency(input), 'BOOKING_VERSION_CHANGED');
});

test('rejects current commercial selection drift', () => {
  const input = validInput();
  input.booking.quantity = 2;
  assertReason(() => assertHospitalityCommercialAmendmentApplyConsistency(input), 'CURRENT_TERMS_CHANGED');
});

test('rejects current booking price drift', () => {
  const input = validInput();
  input.booking.price = { ...before, totalMinor: '12001' };
  assertReason(() => assertHospitalityCommercialAmendmentApplyConsistency(input), 'CURRENT_PRICE_CHANGED');
});

test('rejects target selection fingerprint drift', () => {
  const input = validInput();
  input.targetSelectionFingerprint = fingerprint('d');
  assertReason(() => assertHospitalityCommercialAmendmentApplyConsistency(input), 'TARGET_SELECTION_CHANGED');
});

test('rejects protection quantity drift', () => {
  const input = validInput();
  input.expectedProtectionQuantity = 2;
  assertReason(() => assertHospitalityCommercialAmendmentApplyConsistency(input), 'INVENTORY_PROTECTION_CHANGED');
});

test('rejects missing hold when target inventory protection is required', () => {
  const input = validInput();
  input.amendment.targetHoldId = null;
  assertReason(() => assertHospitalityCommercialAmendmentApplyConsistency(input), 'INVENTORY_PROTECTION_CHANGED');
});

test('rejects target price drift', () => {
  const input = validInput();
  input.freshTargetPrice = {
    ...after,
    accommodationSubtotalMinor: '12600',
    totalMinor: '15100',
    pricingFingerprint: fingerprint('d'),
  };
  assertReason(() => assertHospitalityCommercialAmendmentApplyConsistency(input), 'TARGET_PRICE_CHANGED');
});

test('rejects persisted adjustment fingerprint drift', () => {
  const input = validInput();
  input.amendment.adjustmentFingerprint = fingerprint('d');
  assertReason(() => assertHospitalityCommercialAmendmentApplyConsistency(input), 'ADJUSTMENT_IDENTITY_CHANGED');
});

test('rejects an unexpected hold when no extra protection is required', () => {
  const input = validInput();
  input.amendment.protectionQuantity = 0;
  input.expectedProtectionQuantity = 0;
  assertReason(() => assertHospitalityCommercialAmendmentApplyConsistency(input), 'INVENTORY_PROTECTION_CHANGED');
});
