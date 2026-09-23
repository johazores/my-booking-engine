import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const history = readFileSync('src/server/payments/hospitality-payment-recovery-history.ts', 'utf8');
const manualRecovery = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-recovery-service.ts', 'utf8');
const stripeRecovery = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-stripe-recovery-service.ts', 'utf8');
const stripeCheckoutRecovery = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-stripe-recovery-checkout-service.ts', 'utf8');
const guide = readFileSync('docs/hospitality-payment-history.md', 'utf8');

function recoveryContextBody(source) {
  const start = source.indexOf('async function loadRecoveryContext');
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start, 'loadRecoveryContext boundary must remain discoverable');
  return source.slice(start, end);
}

test('recovery history keeps complete bounded identity evidence', () => {
  assert.match(history, /HOSPITALITY_PAYMENT_RECOVERY_PAGE_SIZE = 100/);
  assert.match(history, /HOSPITALITY_PAYMENT_RECOVERY_MAX_TRANSACTIONS = 1_000/);
  assert.match(history, /idempotencyKey: true/);
  assert.match(history, /requestFingerprint: true/);
  assert.match(history, /cursor: \{ id: cursorId \}/);
  assert.match(history, /select: \{ id: true \}/);
  assert.match(history, /exceeds the \$\{HOSPITALITY_PAYMENT_RECOVERY_MAX_TRANSACTIONS\}-transaction safety limit/);
});

test('manual and Stripe recovery contexts fail closed on incomplete bounded history', () => {
  for (const source of [manualRecovery, stripeRecovery, stripeCheckoutRecovery]) {
    const context = recoveryContextBody(source);
    assert.match(context, /readHospitalityPaymentRecoveryHistory/);
    assert.match(context, /if \(!paymentHistory\.complete\)/);
    assert.match(context, /throw new HospitalityBookingConflictError\(paymentHistory\.reason\)/);
    assert.match(context, /transactions: paymentHistory\.transactions/);
    assert.doesNotMatch(context, /paymentTransaction\.findMany/);
  }
});

test('manual recovery preserves reader-required tenant identity when appending a new payment', () => {
  assert.match(manualRecovery, /organizationId: payment\.organizationId/);
  assert.match(manualRecovery, /bookingId: payment\.bookingId/);
});

test('documentation separates recovery authority from settlement-only history', () => {
  assert.match(guide, /bounded recovery payment history/i);
  assert.match(guide, /idempotencyKey/);
  assert.match(guide, /requestFingerprint/);
  assert.match(guide, /manual recovery/i);
  assert.match(guide, /Stripe recovery/i);
  assert.match(guide, /Stripe recovery Checkout/i);
});
