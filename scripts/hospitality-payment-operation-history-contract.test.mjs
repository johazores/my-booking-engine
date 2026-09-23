import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const history = readFileSync('src/server/payments/hospitality-payment-operation-history.ts', 'utf8');
const checkout = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-stripe-checkout-service.ts', 'utf8');
const guide = readFileSync('docs/hospitality-payment-history.md', 'utf8');

function checkoutContextBody(source) {
  const start = source.indexOf('async function loadCheckoutContext');
  const end = source.indexOf('\nfunction assertCheckoutSnapshot', start + 1);
  assert.ok(start >= 0 && end > start, 'loadCheckoutContext boundary must remain discoverable');
  return source.slice(start, end);
}

test('operation history keeps complete bounded Stripe Checkout identity evidence', () => {
  assert.match(history, /HOSPITALITY_PAYMENT_OPERATION_PAGE_SIZE = 100/);
  assert.match(history, /HOSPITALITY_PAYMENT_OPERATION_MAX_TRANSACTIONS = 1_000/);
  assert.match(history, /organizationId: true/);
  assert.match(history, /bookingId: true/);
  assert.match(history, /commercialAmendmentId: true/);
  assert.match(history, /idempotencyKey: true/);
  assert.match(history, /requestFingerprint: true/);
  assert.match(history, /createdAt: true/);
  assert.match(history, /cursor: \{ id: cursorId \}/);
  assert.match(history, /select: \{ id: true \}/);
  assert.match(history, /exceeds the \$\{HOSPITALITY_PAYMENT_OPERATION_MAX_TRANSACTIONS\}-transaction safety limit/);
});

test('commercial amendment Stripe Checkout fails closed on incomplete operation history', () => {
  const context = checkoutContextBody(checkout);
  assert.match(checkout, /readHospitalityPaymentOperationHistory/);
  assert.match(context, /const paymentHistory = await readHospitalityPaymentOperationHistory/);
  assert.match(context, /if \(!paymentHistory\.complete\)/);
  assert.match(context, /throw new HospitalityBookingConflictError\(paymentHistory\.reason\)/);
  assert.match(context, /transactions: paymentHistory\.transactions/);
  assert.doesNotMatch(context, /paymentTransaction\.findMany/);
});

test('Checkout still derives exact retry and competing-operation authority from complete evidence', () => {
  assert.match(checkout, /context\.transactions\.find\(\(entry\) => entry\.idempotencyKey === idempotencyKey\)/);
  assert.match(checkout, /entry\.commercialAmendmentId === input\.amendmentId/);
  assert.match(checkout, /entry\.status === 'PENDING' \|\| entry\.status === 'AMBIGUOUS'/);
  assert.match(checkout, /payment\.requestFingerprint !== input\.requestFingerprint/);
});

test('documentation separates operation evidence from settlement, recovery, and legal history', () => {
  assert.match(guide, /bounded payment operation evidence/i);
  assert.match(guide, /customer-authorized Stripe commercial-amendment Checkout/i);
  assert.match(guide, /idempotencyKey/);
  assert.match(guide, /requestFingerprint/);
  assert.match(guide, /settlement-only reader/i);
  assert.match(guide, /recovery/i);
  assert.match(guide, /legal/i);
});
