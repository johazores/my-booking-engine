import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const status = read('src/server/payments/stripe-provider-status.ts');

test('Stripe state allowlists distinguish Refund and PaymentIntent authority', () => {
  for (const value of ['pending', 'requires_action', 'succeeded', 'failed', 'canceled']) {
    assert.ok(status.includes(`'${value}'`));
  }
  assert.match(status, /export function isKnownStripePaymentIntentStatus/);
  assert.match(status, /export function isKnownStripeRefundStatus/);
});

test('Stripe write, lookup, webhook, and domain reconciliation enforce known statuses', () => {
  for (const path of [
    'src/server/payments/stripe-payment-provider.ts',
    'src/server/payments/stripe-payment-reconciliation-provider.ts',
    'src/server/payments/stripe-reconciliation-service.ts',
    'src/server/payments/stripe-webhook-domain.ts',
  ]) assert.match(read(path), /isKnownStripePaymentIntentStatus/);
  for (const path of [
    'src/server/payments/stripe-payment-provider.ts',
    'src/server/payments/stripe-refund-reconciliation-provider.ts',
    'src/server/payments/stripe-refund-reconciliation-service.ts',
    'src/server/bookings/booking-commercial-amendment-stripe-refund-domain.ts',
    'src/server/payments/stripe-webhook-domain.ts',
  ]) assert.match(read(path), /isKnownStripeRefundStatus/);
});
