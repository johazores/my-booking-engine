import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveBookingPaymentStatusFromNetSettlement } from './payment-refund-state-domain.ts';

test('derives paid from exact net settlement', () => {
  assert.deepEqual(deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 12_500n, netSettledMinor: 12_500n }), {
    reconciled: true,
    paymentStatus: 'PAID',
  });
});

test('derives partially refunded from a positive balance below total', () => {
  assert.deepEqual(deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 12_500n, netSettledMinor: 10_000n }), {
    reconciled: true,
    paymentStatus: 'PARTIALLY_REFUNDED',
  });
});

test('derives refunded from zero net settlement', () => {
  assert.deepEqual(deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 12_500n, netSettledMinor: 0n }), {
    reconciled: true,
    paymentStatus: 'REFUNDED',
  });
});

test('fails closed when net settlement exceeds the booking total', () => {
  const result = deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 12_500n, netSettledMinor: 12_501n });
  assert.equal(result.reconciled, false);
});

test('fails closed for negative net settlement', () => {
  const result = deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 12_500n, netSettledMinor: -1n });
  assert.equal(result.reconciled, false);
});

test('fails closed for a non-positive booking total', () => {
  const result = deriveBookingPaymentStatusFromNetSettlement({ bookingTotalMinor: 0n, netSettledMinor: 0n });
  assert.equal(result.reconciled, false);
});
