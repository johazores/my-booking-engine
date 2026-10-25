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

test('Stripe money is never synthesized from missing provider fields', () => {
  const lookup = read('src/server/payments/stripe-payment-reconciliation-provider.ts');
  const webhook = read('src/server/payments/stripe-webhook-domain.ts');
  const domain = read('src/server/payments/stripe-reconciliation-service.ts');
  for (const source of [lookup, webhook]) {
    assert.ok(source.includes('intent.amount_received === undefined || intent.amount_capturable === undefined'));
    assert.ok(!source.includes('amount_received ?? 0'));
    assert.ok(!source.includes('amount_capturable ?? 0'));
  }
  assert.ok(lookup.includes('amountReceived + amountCapturable > intent.amount'));
  assert.ok(webhook.includes('Number(amountReceived) + Number(amountCapturable) > Number(intent.amount)'));
  assert.ok(domain.includes('amountReceivedMinor + amountCapturableMinor > amountMinor'));
  for (const path of [
    'src/server/bookings/hospitality-booking-commercial-amendment-stripe-webhook-service.ts',
    'src/server/bookings/hospitality-booking-commercial-amendment-stripe-recovery-webhook-service.ts',
  ]) {
    const source = read(path);
    assert.ok(source.includes('const value = record.amount_capturable;'));
    assert.ok(!source.includes('record.amount_capturable ?? 0'));
  }
});
