import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hospitalityBookingCommercialAllocationLockKeys,
  hospitalityBookingCommercialModificationFingerprint,
  hospitalityBookingCommercialSelectionMatches,
  normalizeHospitalityBookingCommercialModificationInput,
} from './booking-commercial-modification-domain.ts';

const roomA = '11111111-1111-4111-8111-111111111111';
const roomB = '22222222-2222-4222-8222-222222222222';
const rateA = '33333333-3333-4333-8333-333333333333';
const addonA = '44444444-4444-4444-8444-444444444444';
const addonB = '55555555-5555-4555-8555-555555555555';
const organizationId = '66666666-6666-4666-8666-666666666666';
const propertyId = '77777777-7777-4777-8777-777777777777';

test('commercial modification normalization canonicalizes identifiers, quantity, and add-on order', () => {
  const normalized = normalizeHospitalityBookingCommercialModificationInput({
    roomTypeId: roomA.toUpperCase(),
    ratePlanId: rateA,
    quantity: '2',
    idempotencyKey: 'commercial:test-1',
    addonSelections: [
      { addonId: addonB.toUpperCase(), quantity: 1 },
      { addonId: addonA, quantity: 2 },
    ],
  });

  assert.equal(normalized.roomTypeId, roomA);
  assert.equal(normalized.quantity, 2);
  assert.deepEqual(normalized.addonSelections, [
    { addonId: addonA, quantity: 2 },
    { addonId: addonB, quantity: 1 },
  ]);
});

test('commercial modification fingerprint ignores retry identity but changes with commercial terms', () => {
  const first = normalizeHospitalityBookingCommercialModificationInput({
    roomTypeId: roomA,
    ratePlanId: rateA,
    quantity: 1,
    idempotencyKey: 'commercial:fingerprint-a',
    addonSelections: [{ addonId: addonA, quantity: 1 }],
  });
  const retry = normalizeHospitalityBookingCommercialModificationInput({
    ...first,
    idempotencyKey: 'commercial:fingerprint-b',
  });
  const changed = normalizeHospitalityBookingCommercialModificationInput({
    ...first,
    quantity: 2,
    idempotencyKey: 'commercial:fingerprint-c',
  });

  assert.equal(
    hospitalityBookingCommercialModificationFingerprint(first),
    hospitalityBookingCommercialModificationFingerprint(retry),
  );
  assert.notEqual(
    hospitalityBookingCommercialModificationFingerprint(first),
    hospitalityBookingCommercialModificationFingerprint(changed),
  );
});

test('commercial selection comparison is canonical and rejects malformed persisted add-ons', () => {
  const requested = normalizeHospitalityBookingCommercialModificationInput({
    roomTypeId: roomA,
    ratePlanId: rateA,
    quantity: 1,
    idempotencyKey: 'commercial:selection',
    addonSelections: [
      { addonId: addonB, quantity: 1 },
      { addonId: addonA, quantity: 1 },
    ],
  });

  assert.equal(hospitalityBookingCommercialSelectionMatches({
    roomTypeId: roomA,
    ratePlanId: rateA,
    quantity: 1,
    addonSelections: [
      { addonId: addonA, quantity: 1 },
      { addonId: addonB, quantity: 1 },
    ],
  }, requested), true);
  assert.equal(hospitalityBookingCommercialSelectionMatches({
    roomTypeId: roomA,
    ratePlanId: rateA,
    quantity: 1,
    addonSelections: [{ addonId: 'not-a-uuid', quantity: 1 }],
  }, requested), false);
});

test('commercial allocation lock keys are deterministic and deduplicate same-room changes', () => {
  const sameRoom = hospitalityBookingCommercialAllocationLockKeys({
    organizationId,
    propertyId,
    currentRoomTypeId: roomA,
    targetRoomTypeId: roomA,
  });
  const crossRoom = hospitalityBookingCommercialAllocationLockKeys({
    organizationId,
    propertyId,
    currentRoomTypeId: roomB,
    targetRoomTypeId: roomA,
  });

  assert.equal(sameRoom.length, 1);
  assert.equal(crossRoom.length, 2);
  assert.deepEqual(crossRoom, [...crossRoom].sort());
});

test('commercial modification rejects malformed payload and add-on entries before service work', () => {
  assert.throws(() => normalizeHospitalityBookingCommercialModificationInput(null), /payload must be an object/i);
  assert.throws(() => normalizeHospitalityBookingCommercialModificationInput({
    roomTypeId: roomA,
    ratePlanId: rateA,
    quantity: 1,
    idempotencyKey: 'commercial:bad-addon-list',
    addonSelections: [null],
  }), /add-on selection 1 must be an object/i);
  assert.throws(() => normalizeHospitalityBookingCommercialModificationInput({
    roomTypeId: roomA,
    ratePlanId: rateA,
    quantity: 1,
    idempotencyKey: 'commercial:bad-addon-id',
    addonSelections: [{ addonId: 42, quantity: 1 }],
  }), /uuid/i);
});

test('commercial modification rejects invalid quantities and identifiers', () => {
  assert.throws(() => normalizeHospitalityBookingCommercialModificationInput({
    roomTypeId: roomA,
    ratePlanId: rateA,
    quantity: 0,
    idempotencyKey: 'commercial:invalid-quantity',
  }), /between 1 and 50/i);
  assert.throws(() => normalizeHospitalityBookingCommercialModificationInput({
    roomTypeId: 'room-a',
    ratePlanId: rateA,
    quantity: 1,
    idempotencyKey: 'commercial:invalid-room',
  }), /uuid/i);
});
