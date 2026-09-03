import assert from 'node:assert/strict';
import test from 'node:test';

import {
  StripeCommercialAmendmentRecoveryCheckoutConflictError,
  reconcileStripeCommercialAmendmentRecoveryCheckoutSnapshot,
} from './booking-commercial-amendment-stripe-recovery-checkout-reconciliation-domain.ts';
import type { StripeCheckoutSessionSnapshot } from '../payments/stripe-checkout-provider.ts';

const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
const amendmentId = '33333333-3333-4333-8333-333333333333';
const checkoutReference = 'cs_test_recovery_123';

function snapshot(overrides: Partial<StripeCheckoutSessionSnapshot> = {}): StripeCheckoutSessionSnapshot {
  return {
    providerCode: 'stripe',
    sessionReference: checkoutReference,
    status: 'open',
    paymentStatus: 'unpaid',
    paymentIntentReference: null,
    money: { currency: 'USD', amountMinor: 2500n },
    organizationId,
    bookingId,
    commercialAmendmentId: amendmentId,
    purpose: 'commercial-amendment-recovery',
    ...overrides,
  };
}

function reconcile(providerSnapshot: StripeCheckoutSessionSnapshot) {
  return reconcileStripeCommercialAmendmentRecoveryCheckoutSnapshot({
    organizationId,
    bookingId,
    amendmentId,
    checkoutReference,
    currency: 'USD',
    amountMinor: 2500n,
    snapshot: providerSnapshot,
  });
}

test('marks an exact paid recovery Checkout as succeeded', () => {
  const result = reconcile(snapshot({
    status: 'complete',
    paymentStatus: 'paid',
    paymentIntentReference: 'pi_recovery_123',
  }));
  assert.equal(result.state, 'PAID');
  assert.equal(result.transactionStatus, 'SUCCEEDED');
  assert.equal(result.paymentIntentReference, 'pi_recovery_123');
});

test('marks an exact unpaid expired recovery Checkout as failed', () => {
  const result = reconcile(snapshot({ status: 'expired', paymentStatus: 'unpaid' }));
  assert.equal(result.state, 'EXPIRED');
  assert.equal(result.transactionStatus, 'FAILED');
});

test('preserves open and non-final Checkout truth as ambiguous', () => {
  const result = reconcile(snapshot());
  assert.equal(result.state, 'WAIT_FOR_PROVIDER');
  assert.equal(result.transactionStatus, 'AMBIGUOUS');
});

test('preserves an expired Session with a PaymentIntent for provider recovery', () => {
  const result = reconcile(snapshot({
    status: 'expired',
    paymentStatus: 'unpaid',
    paymentIntentReference: 'pi_recovery_pending_123',
  }));
  assert.equal(result.state, 'WAIT_FOR_PROVIDER');
  assert.equal(result.transactionStatus, 'AMBIGUOUS');
});

test('rejects cross-tenant or cross-amendment Checkout ownership', () => {
  assert.throws(
    () => reconcile(snapshot({ organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })),
    StripeCommercialAmendmentRecoveryCheckoutConflictError,
  );
  assert.throws(
    () => reconcile(snapshot({ commercialAmendmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })),
    StripeCommercialAmendmentRecoveryCheckoutConflictError,
  );
});

test('rejects provider money drift', () => {
  assert.throws(
    () => reconcile(snapshot({ money: { currency: 'USD', amountMinor: 2499n } })),
    StripeCommercialAmendmentRecoveryCheckoutConflictError,
  );
  assert.throws(
    () => reconcile(snapshot({ money: { currency: 'EUR', amountMinor: 2500n } })),
    StripeCommercialAmendmentRecoveryCheckoutConflictError,
  );
});

test('rejects paid recovery Checkout without a PaymentIntent', () => {
  assert.throws(
    () => reconcile(snapshot({ status: 'complete', paymentStatus: 'paid' })),
    StripeCommercialAmendmentRecoveryCheckoutConflictError,
  );
});

test('rejects impossible no-payment-required recovery state', () => {
  assert.throws(
    () => reconcile(snapshot({ status: 'complete', paymentStatus: 'no_payment_required' })),
    StripeCommercialAmendmentRecoveryCheckoutConflictError,
  );
});
