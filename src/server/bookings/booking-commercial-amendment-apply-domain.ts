import {
  createHospitalityBookingCommercialAdjustmentPreview,
  type HospitalityBookingCommercialAdjustmentDirection,
  type HospitalityBookingCommercialPriceSnapshot,
} from './booking-commercial-adjustment-domain.ts';

type NormalizedAddonSelection = Readonly<{ addonId: string; quantity: number }>;

type ApplyBookingSnapshot = Readonly<{
  updatedAt: string;
  roomTypeId: string;
  ratePlanId: string;
  quantity: number;
  addonSelections: readonly NormalizedAddonSelection[];
  price: HospitalityBookingCommercialPriceSnapshot;
}>;

type ApplyAmendmentSnapshot = Readonly<{
  bookingVersion: string;
  currentRoomTypeId: string;
  currentRatePlanId: string;
  currentQuantity: number;
  currentAddonSelections: readonly NormalizedAddonSelection[];
  targetRoomTypeId: string;
  targetRatePlanId: string;
  targetQuantity: number;
  targetAddonSelections: readonly NormalizedAddonSelection[];
  selectionFingerprint: string;
  adjustmentFingerprint: string;
  direction: Exclude<HospitalityBookingCommercialAdjustmentDirection, 'NONE'>;
  deltaMinor: string;
  before: HospitalityBookingCommercialPriceSnapshot;
  after: HospitalityBookingCommercialPriceSnapshot;
  protectionQuantity: number;
  targetHoldId: string | null;
}>;

export type HospitalityCommercialAmendmentApplyConsistencyReason =
  | 'BOOKING_VERSION_CHANGED'
  | 'CURRENT_TERMS_CHANGED'
  | 'CURRENT_PRICE_CHANGED'
  | 'TARGET_SELECTION_CHANGED'
  | 'INVENTORY_PROTECTION_CHANGED'
  | 'TARGET_PRICE_CHANGED'
  | 'ADJUSTMENT_IDENTITY_CHANGED';

export class HospitalityCommercialAmendmentApplyConsistencyError extends Error {
  readonly reason: HospitalityCommercialAmendmentApplyConsistencyReason;

  constructor(reason: HospitalityCommercialAmendmentApplyConsistencyReason, message: string) {
    super(message);
    this.name = 'HospitalityCommercialAmendmentApplyConsistencyError';
    this.reason = reason;
  }
}

function snapshotsMatch(
  left: HospitalityBookingCommercialPriceSnapshot,
  right: HospitalityBookingCommercialPriceSnapshot,
) {
  return left.currency === right.currency
    && left.accommodationSubtotalMinor === right.accommodationSubtotalMinor
    && left.taxTotalMinor === right.taxTotalMinor
    && left.feeTotalMinor === right.feeTotalMinor
    && left.addonTotalMinor === right.addonTotalMinor
    && left.totalMinor === right.totalMinor
    && left.pricingFingerprint === right.pricingFingerprint;
}

function selectionsMatch(
  left: readonly NormalizedAddonSelection[],
  right: readonly NormalizedAddonSelection[],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function consistencyError(
  reason: HospitalityCommercialAmendmentApplyConsistencyReason,
  message: string,
): never {
  throw new HospitalityCommercialAmendmentApplyConsistencyError(reason, message);
}

export function assertHospitalityCommercialAmendmentApplyConsistency(input: {
  bookingId: string;
  booking: ApplyBookingSnapshot;
  amendment: ApplyAmendmentSnapshot;
  freshTargetPrice: HospitalityBookingCommercialPriceSnapshot;
  targetSelectionFingerprint: string;
  expectedProtectionQuantity: number;
}) {
  if (input.booking.updatedAt !== input.amendment.bookingVersion) {
    consistencyError(
      'BOOKING_VERSION_CHANGED',
      'Booking version changed after the commercial amendment was prepared.',
    );
  }
  if (
    input.booking.roomTypeId !== input.amendment.currentRoomTypeId
    || input.booking.ratePlanId !== input.amendment.currentRatePlanId
    || input.booking.quantity !== input.amendment.currentQuantity
    || !selectionsMatch(input.booking.addonSelections, input.amendment.currentAddonSelections)
  ) {
    consistencyError(
      'CURRENT_TERMS_CHANGED',
      'Booking commercial terms changed after the commercial amendment was prepared.',
    );
  }
  if (!snapshotsMatch(input.booking.price, input.amendment.before)) {
    consistencyError(
      'CURRENT_PRICE_CHANGED',
      'Booking price snapshot changed after the commercial amendment was prepared.',
    );
  }
  if (input.targetSelectionFingerprint !== input.amendment.selectionFingerprint) {
    consistencyError(
      'TARGET_SELECTION_CHANGED',
      'Commercial amendment target selection does not match its persisted fingerprint.',
    );
  }
  if (input.expectedProtectionQuantity !== input.amendment.protectionQuantity) {
    consistencyError(
      'INVENTORY_PROTECTION_CHANGED',
      'Commercial amendment inventory protection no longer matches the target selection.',
    );
  }
  if (
    (input.amendment.protectionQuantity > 0 && !input.amendment.targetHoldId)
    || (input.amendment.protectionQuantity === 0 && input.amendment.targetHoldId)
  ) {
    consistencyError(
      'INVENTORY_PROTECTION_CHANGED',
      'Commercial amendment target inventory protection is inconsistent.',
    );
  }

  const preview = createHospitalityBookingCommercialAdjustmentPreview({
    bookingId: input.bookingId,
    bookingVersion: input.amendment.bookingVersion,
    selectionFingerprint: input.amendment.selectionFingerprint,
    before: input.booking.price,
    after: input.freshTargetPrice,
  });
  if (preview.direction === 'NONE') {
    consistencyError(
      'TARGET_PRICE_CHANGED',
      'Commercial amendment no longer has a price adjustment.',
    );
  }
  if (!snapshotsMatch(preview.after, input.amendment.after)) {
    consistencyError(
      'TARGET_PRICE_CHANGED',
      'Commercial amendment target price changed after preparation.',
    );
  }
  if (
    preview.direction !== input.amendment.direction
    || preview.deltaMinor !== input.amendment.deltaMinor
    || preview.adjustmentFingerprint !== input.amendment.adjustmentFingerprint
  ) {
    consistencyError(
      'ADJUSTMENT_IDENTITY_CHANGED',
      'Commercial amendment adjustment identity no longer matches current authoritative pricing.',
    );
  }
  return preview;
}
