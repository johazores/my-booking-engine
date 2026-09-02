import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSPITALITY_COMMERCIAL_AMENDMENT_EXPIRES_MINUTES,
  hospitalityCommercialAmendmentExpiresAt,
  hospitalityCommercialAmendmentHoldIdempotencyKey,
  hospitalityCommercialAmendmentProtectionQuantity,
  normalizeHospitalityCommercialAdjustmentFingerprint,
} from './booking-commercial-amendment-domain.ts';

const fingerprint = 'a'.repeat(64);

test('protects the full target quantity when changing room type', () => {
  assert.equal(hospitalityCommercialAmendmentProtectionQuantity({
    currentRoomTypeId: 'room-a', currentQuantity: 2, targetRoomTypeId: 'room-b', targetQuantity: 3,
  }), 3);
});

test('protects only incremental units when increasing the same room type', () => {
  assert.equal(hospitalityCommercialAmendmentProtectionQuantity({
    currentRoomTypeId: 'room-a', currentQuantity: 2, targetRoomTypeId: 'room-a', targetQuantity: 5,
  }), 3);
});

test('does not double-protect inventory for same-room decreases or price-only changes', () => {
  assert.equal(hospitalityCommercialAmendmentProtectionQuantity({
    currentRoomTypeId: 'room-a', currentQuantity: 3, targetRoomTypeId: 'room-a', targetQuantity: 2,
  }), 0);
  assert.equal(hospitalityCommercialAmendmentProtectionQuantity({
    currentRoomTypeId: 'room-a', currentQuantity: 3, targetRoomTypeId: 'room-a', targetQuantity: 3,
  }), 0);
});

test('uses a bounded deterministic amendment expiry window', () => {
  const now = new Date('2026-09-03T00:00:00.000Z');
  assert.equal(
    hospitalityCommercialAmendmentExpiresAt(now).toISOString(),
    new Date(now.getTime() + HOSPITALITY_COMMERCIAL_AMENDMENT_EXPIRES_MINUTES * 60_000).toISOString(),
  );
});

test('creates stable hold identities without exposing the original idempotency key', () => {
  const input = {
    organizationId: 'ORG', bookingId: 'BOOKING', idempotencyKey: 'staff-request-123', adjustmentFingerprint: fingerprint,
  };
  const first = hospitalityCommercialAmendmentHoldIdempotencyKey(input);
  const second = hospitalityCommercialAmendmentHoldIdempotencyKey(input);
  assert.equal(first, second);
  assert.match(first, /^commercial-amendment:[a-f0-9]{64}$/);
  assert.equal(first.includes(input.idempotencyKey), false);
});

test('rejects malformed adjustment fingerprints', () => {
  assert.throws(() => normalizeHospitalityCommercialAdjustmentFingerprint('not-a-fingerprint'), /SHA-256/);
});
