import { createHash } from 'node:crypto';

import { hospitalityAvailabilityAllocationLockKey } from '../availability/availability-allocation-lock.ts';
import { normalizeHospitalityAddonSelections, type HospitalityAddonSelectionInput } from '../pricing/hospitality-addon-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { normalizeBookingIdempotencyKey } from './booking-domain.ts';

export type HospitalityBookingCommercialModificationInput = {
  roomTypeId: string;
  ratePlanId: string;
  quantity: number | string;
  addonSelections?: HospitalityAddonSelectionInput[];
  idempotencyKey: string;
};

export type NormalizedHospitalityBookingCommercialModification = {
  roomTypeId: string;
  ratePlanId: string;
  quantity: number;
  addonSelections: ReturnType<typeof normalizeHospitalityAddonSelections>;
  idempotencyKey: string;
};

function normalizeUuid(value: unknown, label: string) {
  if (typeof value !== 'string') throw new Error(`${label} must be a valid UUID.`);
  const normalized = value.trim().toLowerCase();
  assertUuidIdentifier(normalized, label);
  return normalized;
}

function normalizeQuantity(value: number | string) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new Error('Room quantity must be a whole number between 1 and 50.');
  }
  return parsed;
}

export function normalizeHospitalityBookingCommercialModificationInput(
  input: HospitalityBookingCommercialModificationInput,
): NormalizedHospitalityBookingCommercialModification {
  return {
    roomTypeId: normalizeUuid(input.roomTypeId, 'roomTypeId'),
    ratePlanId: normalizeUuid(input.ratePlanId, 'ratePlanId'),
    quantity: normalizeQuantity(input.quantity),
    addonSelections: normalizeHospitalityAddonSelections(input.addonSelections ?? []),
    idempotencyKey: normalizeBookingIdempotencyKey(input.idempotencyKey),
  };
}

export function hospitalityBookingCommercialModificationFingerprint(
  input: NormalizedHospitalityBookingCommercialModification,
) {
  return createHash('sha256').update(JSON.stringify({
    roomTypeId: input.roomTypeId,
    ratePlanId: input.ratePlanId,
    quantity: input.quantity,
    addonSelections: input.addonSelections,
  })).digest('hex');
}

export function hospitalityBookingCommercialSelectionMatches(
  current: {
    roomTypeId: string;
    ratePlanId: string;
    quantity: number;
    addonSelections: unknown;
  },
  requested: NormalizedHospitalityBookingCommercialModification,
) {
  if (!Array.isArray(current.addonSelections)) return false;
  let currentAddons;
  try {
    currentAddons = normalizeHospitalityAddonSelections(current.addonSelections as HospitalityAddonSelectionInput[]);
  } catch {
    return false;
  }
  return current.roomTypeId === requested.roomTypeId
    && current.ratePlanId === requested.ratePlanId
    && current.quantity === requested.quantity
    && JSON.stringify(currentAddons) === JSON.stringify(requested.addonSelections);
}

export function hospitalityBookingCommercialAllocationLockKeys(input: {
  organizationId: string;
  propertyId: string;
  currentRoomTypeId: string;
  targetRoomTypeId: string;
}) {
  return [...new Set([
    hospitalityAvailabilityAllocationLockKey({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      roomTypeId: input.currentRoomTypeId,
    }),
    hospitalityAvailabilityAllocationLockKey({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      roomTypeId: input.targetRoomTypeId,
    }),
  ])].sort();
}
