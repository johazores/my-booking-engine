import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeRentalBookingConfirmationInput,
  rentalBookingConfirmationPayloadMatches,
} from './rental-booking-domain.ts';

const fingerprint = 'a'.repeat(64);

void test('rental booking confirmation normalizes stable idempotency and authority evidence', () => {
  assert.deepEqual(
    normalizeRentalBookingConfirmationInput({
      holdId: ' hold-id ',
      customerId: ' customer-id ',
      idempotencyKey: ' booking:stable-key ',
      authorityFingerprint: fingerprint.toUpperCase(),
    }),
    {
      holdId: 'hold-id',
      customerId: 'customer-id',
      idempotencyKey: 'booking:stable-key',
      authorityFingerprint: fingerprint,
    },
  );
});

void test('rental booking confirmation rejects malformed write authority', () => {
  assert.throws(() => normalizeRentalBookingConfirmationInput({
    holdId: 'hold-id',
    customerId: 'customer-id',
    idempotencyKey: 'short',
    authorityFingerprint: fingerprint,
  }), /Idempotency key/i);
  assert.throws(() => normalizeRentalBookingConfirmationInput({
    holdId: 'hold-id',
    customerId: 'customer-id',
    idempotencyKey: 'booking:stable-key',
    authorityFingerprint: 'not-a-fingerprint',
  }), /fingerprint/i);
});

void test('rental booking confirmation idempotency requires the same hold, customer, and authority', () => {
  const booking = {
    holdId: 'hold-1',
    customerId: 'customer-1',
    authorityFingerprint: fingerprint,
  };
  assert.equal(rentalBookingConfirmationPayloadMatches({ booking, requested: booking }), true);
  assert.equal(rentalBookingConfirmationPayloadMatches({
    booking,
    requested: { ...booking, customerId: 'customer-2' },
  }), false);
  assert.equal(rentalBookingConfirmationPayloadMatches({
    booking,
    requested: { ...booking, authorityFingerprint: 'b'.repeat(64) },
  }), false);
});
