import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalityBookingRescheduleValidationError,
  hospitalityBookingPriceSnapshotMatches,
  normalizeHospitalityBookingRescheduleInput,
} from './booking-reschedule-domain.ts';

test('booking reschedule input normalizes dates and requires a durable idempotency key', () => {
  const result = normalizeHospitalityBookingRescheduleInput({
    arrivalDate: '2026-10-10',
    departureDate: '2026-10-13',
    idempotencyKey: 'reschedule:abc12345',
  });
  assert.equal(result.arrivalDate.toISOString().slice(0, 10), '2026-10-10');
  assert.equal(result.departureDate.toISOString().slice(0, 10), '2026-10-13');
  assert.equal(result.stayNights, 3);
  assert.equal(result.idempotencyKey, 'reschedule:abc12345');
});

test('booking reschedule rejects invalid ranges and weak idempotency keys', () => {
  assert.throws(() => normalizeHospitalityBookingRescheduleInput({ arrivalDate: '2026-10-10', departureDate: '2026-10-10', idempotencyKey: 'reschedule:abc12345' }), HospitalityBookingRescheduleValidationError);
  assert.throws(() => normalizeHospitalityBookingRescheduleInput({ arrivalDate: '2026-10-10', departureDate: '2026-10-11', idempotencyKey: 'short' }), HospitalityBookingRescheduleValidationError);
});

test('booking reschedule only accepts a zero commercial delta', () => {
  const current = {
    currency: 'USD',
    accommodationSubtotalMinor: 20000n,
    taxTotalMinor: 2000n,
    feeTotalMinor: 1000n,
    addonTotalMinor: 500n,
    totalMinor: 23500n,
  };
  assert.equal(hospitalityBookingPriceSnapshotMatches(current, {
    currency: 'USD',
    accommodationSubtotalMinor: '20000',
    taxTotalMinor: '2000',
    feeTotalMinor: '1000',
    addonTotalMinor: '500',
    totalMinor: '23500',
  }), true);
  assert.equal(hospitalityBookingPriceSnapshotMatches(current, {
    currency: 'USD',
    accommodationSubtotalMinor: '21000',
    taxTotalMinor: '2000',
    feeTotalMinor: '1000',
    addonTotalMinor: '500',
    totalMinor: '24500',
  }), false);
  assert.equal(hospitalityBookingPriceSnapshotMatches(current, {
    currency: 'EUR',
    accommodationSubtotalMinor: '20000',
    taxTotalMinor: '2000',
    feeTotalMinor: '1000',
    addonTotalMinor: '500',
    totalMinor: '23500',
  }), false);
});
