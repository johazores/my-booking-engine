import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const history = readFileSync('src/server/payments/hospitality-payment-receipt-history.ts', 'utf8');
const staffReceipt = readFileSync('src/server/payments/payment-receipt-service.ts', 'utf8');
const publicReceipt = readFileSync('src/server/payments/public-payment-receipt-service.ts', 'utf8');
const guide = readFileSync('docs/payment-receipt-history.md', 'utf8');

test('payment receipt evidence is tenant-scoped, successful-only, cursor-paginated, and bounded', () => {
  assert.match(history, /HOSPITALITY_PAYMENT_RECEIPT_PAGE_SIZE = 100/);
  assert.match(history, /HOSPITALITY_PAYMENT_RECEIPT_MAX_TRANSACTIONS = 1_000/);
  assert.match(history, /organizationId: input\.organizationId/);
  assert.match(history, /bookingId: input\.bookingId/);
  assert.match(history, /status: 'SUCCEEDED'/);
  assert.match(history, /orderBy: \{ id: 'asc' \}/);
  assert.match(history, /cursor: \{ id: cursorId \}/);
  assert.match(history, /take: 1/);
  assert.match(history, /presentation safety limit/);
});

test('staff payment receipts fail closed on incomplete bounded evidence', () => {
  assert.match(staffReceipt, /readHospitalityPaymentReceiptHistory/);
  assert.match(staffReceipt, /if \(!paymentHistory\.complete\)/);
  assert.match(staffReceipt, /throw new PaymentConflictError\(paymentHistory\.reason\)/);
  assert.match(staffReceipt, /sanitizeSuccessfulPaymentTransactions\(paymentHistory\.transactions, booking\.currency\)/);
  assert.doesNotMatch(staffReceipt, /paymentTransaction\.findMany/);
});

test('public payment receipts use the same bounded tenant booking evidence', () => {
  assert.match(publicReceipt, /readHospitalityPaymentReceiptHistory/);
  assert.match(publicReceipt, /organizationId: branding\.id/);
  assert.match(publicReceipt, /bookingId: capability\.bookingId/);
  assert.match(publicReceipt, /if \(!paymentHistory\.complete\) throw new PaymentConflictError\(paymentHistory\.reason\)/);
  assert.match(publicReceipt, /sanitizeSuccessfulPaymentTransactions\(paymentHistory\.transactions, booking\.currency\)/);
  assert.doesNotMatch(publicReceipt, /paymentTransaction\.findMany/);
});

test('documentation distinguishes receipt presentation evidence from settlement authority', () => {
  assert.match(guide, /successful-only/i);
  assert.match(guide, /100-row cursor pages/i);
  assert.match(guide, /1,000 successful transactions/i);
  assert.match(guide, /fails closed/i);
  assert.match(guide, /not financial authority/i);
  assert.match(guide, /authenticated staff/i);
  assert.match(guide, /public capability/i);
});
