import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertBookingPriceSnapshotMatchesConfirmation,
  assertBookingStateTransition,
  bookingConfirmationPayloadMatches,
  canTransitionBookingState,
  createHospitalityPriceSnapshot,
  normalizeBookingIdempotencyKey,
  normalizeBookingPricingFingerprint,
  normalizeHospitalityBookingConfirmationInput,
} from './booking-domain.ts';

const fingerprint = 'a'.repeat(64);
const holdId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const addonA = '33333333-3333-4333-8333-333333333333';
const addonB = '44444444-4444-4444-8444-444444444444';

test('normalizes booking confirmation boundaries, UUIDs, add-ons, and idempotency inputs', () => {
  assert.deepEqual(normalizeHospitalityBookingConfirmationInput({
    holdId: ` ${holdId.toUpperCase()} `,
    customerId: ` ${customerId.toUpperCase()} `,
    idempotencyKey: 'booking:12345',
    expectedPricingFingerprint: fingerprint.toUpperCase(),
    addonSelections: [{ addonId: addonB, quantity: 1 }, { addonId: addonA, quantity: 2 }],
  }), {
    holdId,
    customerId,
    idempotencyKey: 'booking:12345',
    expectedPricingFingerprint: fingerprint,
    addonSelections: [{ addonId: addonA, quantity: 2 }, { addonId: addonB, quantity: 1 }],
  });
  assert.throws(() => normalizeHospitalityBookingConfirmationInput({ holdId: 'hold-id', customerId, idempotencyKey: 'booking:12345', expectedPricingFingerprint: fingerprint }), /UUID/);
  assert.throws(() => normalizeHospitalityBookingConfirmationInput({ holdId, customerId: 'customer-id', idempotencyKey: 'booking:12345', expectedPricingFingerprint: fingerprint }), /UUID/);
  assert.throws(() => normalizeBookingIdempotencyKey('short'), /8-120/);
  assert.throws(() => normalizeBookingIdempotencyKey('booking key with spaces'), /8-120/);
  assert.throws(() => normalizeBookingPricingFingerprint('not-a-fingerprint'), /SHA-256/);
});

test('creates exact immutable price snapshots and rejects inconsistent totals', () => {
  const snapshot = createHospitalityPriceSnapshot({ currency: 'usd', accommodationSubtotalMinor: '20000', taxTotalMinor: '2400', feeTotalMinor: '500', addonTotalMinor: '1200', totalMinor: '24100', pricingFingerprint: fingerprint });
  assert.deepEqual(snapshot, { currency: 'USD', accommodationSubtotalMinor: '20000', taxTotalMinor: '2400', feeTotalMinor: '500', addonTotalMinor: '1200', totalMinor: '24100', pricingFingerprint: fingerprint });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(() => createHospitalityPriceSnapshot({ currency: 'USD', accommodationSubtotalMinor: '20000', taxTotalMinor: '2400', feeTotalMinor: '500', addonTotalMinor: '1200', totalMinor: '24099', pricingFingerprint: fingerprint }), /must equal/);
  assert.throws(() => createHospitalityPriceSnapshot({ currency: 'USD', accommodationSubtotalMinor: '20.00', taxTotalMinor: '0', feeTotalMinor: '0', addonTotalMinor: '0', totalMinor: '2000', pricingFingerprint: fingerprint }), /integer minor-unit/);
});

test('requires the immutable snapshot to match the confirmation fingerprint', () => {
  const confirmation = { holdId, customerId, idempotencyKey: 'booking:12345', expectedPricingFingerprint: fingerprint };
  const snapshot = createHospitalityPriceSnapshot({ currency: 'USD', accommodationSubtotalMinor: '20000', taxTotalMinor: '2400', feeTotalMinor: '500', addonTotalMinor: '1200', totalMinor: '24100', pricingFingerprint: fingerprint });
  assert.doesNotThrow(() => assertBookingPriceSnapshotMatchesConfirmation(confirmation, snapshot));
  assert.throws(() => assertBookingPriceSnapshotMatchesConfirmation({ ...confirmation, expectedPricingFingerprint: 'b'.repeat(64) }, snapshot), /does not match/);
});

test('keeps booking lifecycle explicit and separate from payment state', () => {
  assert.equal(canTransitionBookingState('PENDING_CONFIRMATION', 'CONFIRMED'), true);
  assert.equal(canTransitionBookingState('PENDING_CONFIRMATION', 'CANCELLED'), true);
  assert.equal(canTransitionBookingState('CONFIRMED', 'CANCELLED'), true);
  assert.equal(canTransitionBookingState('CONFIRMED', 'PENDING_CONFIRMATION'), false);
  assert.equal(canTransitionBookingState('CANCELLED', 'CONFIRMED'), false);
  assert.throws(() => assertBookingStateTransition('CANCELLED', 'CONFIRMED'), /cannot transition/);
});

test('detects idempotent booking retries and mismatched payload reuse including add-ons', () => {
  const original = { holdId, customerId, idempotencyKey: 'booking:12345', expectedPricingFingerprint: fingerprint, addonSelections: [{ addonId: addonA, quantity: 2 }] };
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original }), true);
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original, holdId: '55555555-5555-4555-8555-555555555555' }), false);
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original, customerId: '66666666-6666-4666-8666-666666666666' }), false);
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original, expectedPricingFingerprint: 'b'.repeat(64) }), false);
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original, addonSelections: [{ addonId: addonA, quantity: 1 }] }), false);
});
