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
  input: HospitalityBookingCommercialModificationInput | unknown,
): NormalizedHospitalityBookingCommercialModification {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Commercial modification payload must be an object.');
  }
  const payload = input as Record<string, unknown>;
  const rawAddons = payload.addonSelections ?? [];
  if (!Array.isArray(rawAddons)) throw new Error('Add-on selections must be an array.');

  const addonSelections = rawAddons.map((selection, index) => {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      throw new Error(`Add-on selection ${index + 1} must be an object.`);
    }
    const record = selection as Record<string, unknown>;
    return {
      addonId: normalizeUuid(record.addonId, `Add-on selection ${index + 1} addonId`),
      quantity: record.quantity as number,
    };
  });

  return {
    roomTypeId: normalizeUuid(payload.roomTypeId, 'roomTypeId'),
    ratePlanId: normalizeUuid(payload.ratePlanId, 'ratePlanId'),
    quantity: normalizeQuantity(payload.quantity as number | string),
    addonSelections: normalizeHospitalityAddonSelections(addonSelections),
    idempotencyKey: normalizeBookingIdempotencyKey(payload.idempotencyKey),
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
