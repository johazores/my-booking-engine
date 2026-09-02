import { createHash } from 'node:crypto';

export const HOSPITALITY_COMMERCIAL_AMENDMENT_EXPIRES_MINUTES = 15;

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

function normalizeFingerprint(value: unknown, label: string) {
  if (typeof value !== 'string') throw new Error(`${label} must be a SHA-256 fingerprint.`);
  const normalized = value.trim().toLowerCase();
  if (!FINGERPRINT_PATTERN.test(normalized)) throw new Error(`${label} must be a SHA-256 fingerprint.`);
  return normalized;
}

function normalizeRoomTypeId(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeQuantity(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new Error(`${label} must be a whole number between 1 and 50.`);
  }
  return value;
}

export function normalizeHospitalityCommercialAdjustmentFingerprint(value: unknown) {
  return normalizeFingerprint(value, 'adjustmentFingerprint');
}

export function hospitalityCommercialAmendmentProtectionQuantity(input: {
  currentRoomTypeId: string;
  currentQuantity: number;
  targetRoomTypeId: string;
  targetQuantity: number;
}) {
  const currentRoomTypeId = normalizeRoomTypeId(input.currentRoomTypeId, 'currentRoomTypeId');
  const targetRoomTypeId = normalizeRoomTypeId(input.targetRoomTypeId, 'targetRoomTypeId');
  const currentQuantity = normalizeQuantity(input.currentQuantity, 'currentQuantity');
  const targetQuantity = normalizeQuantity(input.targetQuantity, 'targetQuantity');

  if (currentRoomTypeId !== targetRoomTypeId) return targetQuantity;
  return Math.max(0, targetQuantity - currentQuantity);
}

export function hospitalityCommercialAmendmentExpiresAt(now: Date) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('now must be a valid Date.');
  return new Date(now.getTime() + HOSPITALITY_COMMERCIAL_AMENDMENT_EXPIRES_MINUTES * 60_000);
}

export function hospitalityCommercialAmendmentHoldIdempotencyKey(input: {
  organizationId: string;
  bookingId: string;
  idempotencyKey: string;
  adjustmentFingerprint: string;
}) {
  const payload = {
    organizationId: input.organizationId.trim().toLowerCase(),
    bookingId: input.bookingId.trim().toLowerCase(),
    idempotencyKey: input.idempotencyKey.trim(),
    adjustmentFingerprint: normalizeHospitalityCommercialAdjustmentFingerprint(input.adjustmentFingerprint),
  };
  if (!payload.organizationId || !payload.bookingId || !payload.idempotencyKey) {
    throw new Error('Commercial amendment hold identity is incomplete.');
  }
  return `commercial-amendment:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}
