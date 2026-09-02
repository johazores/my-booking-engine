import assert from 'node:assert/strict';
import test from 'node:test';

import { decidePublicStripePaymentRecovery } from './public-stripe-payment-recovery-domain.ts';

function decide(overrides: Partial<Parameters<typeof decidePublicStripePaymentRecovery>[0]> = {}) {
  return decidePublicStripePaymentRecovery({
    bookingStatus: 'CONFIRMED',
    bookingPaymentStatus: 'UNPAID',
    pendingAllocationProtected: true,
    latestPaymentStatus: null,
    hasOpenCheckout: false,
    ...overrides,
  });
}

test('allows an active unpaid booking to start or continue payment', () => {
  assert.deepEqual(decide(), {
    state: 'PAYMENT_REQUIRED',
    canResumeCheckout: false,
    canContinuePayment: true,
  });
});

test('allows a persisted open Checkout session to be resumed with the existing request key', () => {
  assert.deepEqual(decide({ latestPaymentStatus: 'PENDING', hasOpenCheckout: true }), {
    state: 'PROCESSING',
    canResumeCheckout: true,
    canContinuePayment: true,
  });
});

test('allows a pending provider-start claim to be retried even before a Checkout session is persisted', () => {
  assert.deepEqual(decide({ latestPaymentStatus: 'PENDING' }), {
    state: 'PROCESSING',
    canResumeCheckout: false,
    canContinuePayment: true,
  });
});

test('does not invite another Checkout attempt while provider state is ambiguous', () => {
  assert.deepEqual(decide({ latestPaymentStatus: 'AMBIGUOUS', hasOpenCheckout: true }), {
    state: 'PROCESSING',
    canResumeCheckout: false,
    canContinuePayment: false,
  });
});

test('failed payment can start a new attempt while the booking is still protected', () => {
  assert.deepEqual(decide({ latestPaymentStatus: 'FAILED', bookingPaymentStatus: 'FAILED' }), {
    state: 'FAILED',
    canResumeCheckout: false,
    canContinuePayment: true,
  });
});

test('terminal and expired bookings never offer payment continuation', () => {
  for (const [overrides, expected] of [
    [{ bookingStatus: 'CANCELLED', latestPaymentStatus: 'PENDING', hasOpenCheckout: true }, 'CANCELLED'],
    [{ bookingPaymentStatus: 'PAID', latestPaymentStatus: 'PENDING', hasOpenCheckout: true }, 'PAID'],
    [{ pendingAllocationProtected: false, latestPaymentStatus: 'PENDING', hasOpenCheckout: true }, 'EXPIRED'],
  ] as const) {
    const result = decide(overrides);
    assert.equal(result.state, expected);
    assert.equal(result.canResumeCheckout, false);
    assert.equal(result.canContinuePayment, false);
  }
});
