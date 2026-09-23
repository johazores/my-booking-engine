import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const availability = readFileSync('src/server/payments/booking-refund-availability-service.ts', 'utf8');
const paymentService = readFileSync('src/server/payments/payment-service.ts', 'utf8');
const stripeRefund = readFileSync('src/server/payments/stripe-refund-service.ts', 'utf8');
const stripeRefundReconciliation = readFileSync('src/server/payments/stripe-refund-reconciliation-service.ts', 'utf8');
const stripeRefundLifecycle = readFileSync('src/server/payments/stripe-refund-lifecycle-service.ts', 'utf8');
const guide = readFileSync('docs/hospitality-payment-history.md', 'utf8');

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('refund availability fails closed on incomplete bounded settlement history', () => {
  assert.match(availability, /readHospitalityPaymentSettlementHistory/);
  assert.match(availability, /if \(!paymentHistory\.complete\)/);
  assert.match(availability, /reason: paymentHistory\.reason/);
  assert.match(availability, /transactions: paymentHistory\.transactions/);
  assert.doesNotMatch(availability, /paymentTransaction\.findMany/);
});

test('manual offline refund derives money authority only from complete bounded settlement history', () => {
  const refund = section(paymentService, 'export async function recordManualOfflineRefund', 'export async function listBookingPaymentTransactions');
  assert.match(refund, /readHospitalityPaymentSettlementHistory/);
  assert.match(refund, /if \(!paymentHistory\.complete\) throw new PaymentConflictError\(paymentHistory\.reason\)/);
  assert.match(refund, /transactions: paymentHistory\.transactions/);
  assert.doesNotMatch(refund, /paymentTransaction\.findMany/);

  const listing = paymentService.slice(paymentService.indexOf('export async function listBookingPaymentTransactions'));
  assert.match(listing, /paymentTransaction\.findMany/);
  assert.match(listing, /take: pagination\.pageSize/);
});

test('direct Stripe refund claims and successful settlement reconciliation use complete bounded history', () => {
  assert.match(stripeRefund, /readHospitalityPaymentSettlementHistory/);
  assert.ok((stripeRefund.match(/readHospitalityPaymentSettlementHistory/g) ?? []).length >= 2);
  assert.ok((stripeRefund.match(/if \(!paymentHistory\.complete\) throw new PaymentConflictError\(paymentHistory\.reason\)/g) ?? []).length >= 2);
  assert.match(stripeRefund, /const ledger = paymentHistory\.transactions/);
  assert.match(stripeRefund, /transactions: paymentHistory\.transactions/);
  assert.doesNotMatch(stripeRefund, /paymentTransaction\.findMany/);
});

test('explicit Stripe refund reconciliation revalidates bounded history before provider and persistence authority', () => {
  assert.match(stripeRefundReconciliation, /readHospitalityPaymentSettlementHistory/);
  assert.ok((stripeRefundReconciliation.match(/readHospitalityPaymentSettlementHistory/g) ?? []).length >= 2);
  assert.match(stripeRefundReconciliation, /if \(!paymentHistory\.complete\) throw new PaymentConflictError\(paymentHistory\.reason\)/);
  assert.match(stripeRefundReconciliation, /if \(!currentPaymentHistory\.complete\) throw new PaymentConflictError\(currentPaymentHistory\.reason\)/);
  assert.match(stripeRefundReconciliation, /paymentHistory\.transactions\.filter/);
  assert.match(stripeRefundReconciliation, /currentPaymentHistory\.transactions\.filter/);
  assert.doesNotMatch(stripeRefundReconciliation, /paymentTransaction\.findMany/);
});

test('verified Stripe refund lifecycle mutation requires complete bounded history', () => {
  assert.match(stripeRefundLifecycle, /readHospitalityPaymentSettlementHistory/);
  assert.match(stripeRefundLifecycle, /if \(!paymentHistory\.complete\) throw new PaymentConflictError\(paymentHistory\.reason\)/);
  assert.match(stripeRefundLifecycle, /paymentHistory\.transactions\.filter/);

  const fullLedgerReads = stripeRefundLifecycle.match(/paymentTransaction\.findMany\(\{[\s\S]*?\}\);/g) ?? [];
  assert.equal(fullLedgerReads.length, 1);
  assert.match(fullLedgerReads[0], /providerReference: event\.refund\.refundReference/);
  assert.match(fullLedgerReads[0], /take: 2/);
});

test('payment history documentation covers normal refund money authority and bounded query exceptions', () => {
  assert.match(guide, /normal booking refund/i);
  assert.match(guide, /refund availability/i);
  assert.match(guide, /manual offline refund/i);
  assert.match(guide, /direct Stripe refund/i);
  assert.match(guide, /refund reconciliation/i);
  assert.match(guide, /fails closed/i);
  assert.match(guide, /exact provider-reference/i);
  assert.match(guide, /paginated transaction listing/i);
});
