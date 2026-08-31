import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertBookingStateTransition,
  bookingConfirmationPayloadMatches,
  canTransitionBookingState,
  createHospitalityPriceSnapshot,
  normalizeBookingIdempotencyKey,
  normalizeBookingPricingFingerprint,
  normalizeHospitalityBookingConfirmationInput,
} from './booking-domain.ts';

const fingerprint = 'a'.repeat(64);

test('normalizes booking confirmation boundaries and strict idempotency inputs', () => {
  assert.deepEqual(normalizeHospitalityBookingConfirmationInput({ holdId: ' hold-id ', customerId: ' customer-id ', idempotencyKey: 'booking:12345', expectedPricingFingerprint: fingerprint.toUpperCase() }), { holdId: 'hold-id', customerId: 'customer-id', idempotencyKey: 'booking:12345', expectedPricingFingerprint: fingerprint });
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

test('keeps booking lifecycle explicit and separate from payment state', () => {
  assert.equal(canTransitionBookingState('PENDING_CONFIRMATION', 'CONFIRMED'), true);
  assert.equal(canTransitionBookingState('PENDING_CONFIRMATION', 'CANCELLED'), true);
  assert.equal(canTransitionBookingState('CONFIRMED', 'CANCELLED'), true);
  assert.equal(canTransitionBookingState('CONFIRMED', 'PENDING_CONFIRMATION'), false);
  assert.equal(canTransitionBookingState('CANCELLED', 'CONFIRMED'), false);
  assert.throws(() => assertBookingStateTransition('CANCELLED', 'CONFIRMED'), /cannot transition/);
});

test('detects idempotent booking retries and mismatched payload reuse', () => {
  const original = { holdId: 'hold-1', customerId: 'customer-1', idempotencyKey: 'booking:12345', expectedPricingFingerprint: fingerprint };
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original }), true);
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original, holdId: 'hold-2' }), false);
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original, customerId: 'customer-2' }), false);
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original, expectedPricingFingerprint: 'b'.repeat(64) }), false);
});
