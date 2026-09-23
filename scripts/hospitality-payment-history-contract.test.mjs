import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const history = readFileSync('src/server/payments/hospitality-payment-history.ts', 'utf8');
const settlement = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-settlement-service.ts', 'utf8');
const guard = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-guard.ts', 'utf8');
const transport = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-transport-service.ts', 'utf8');
const applyRecovery = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-apply-recovery-service.ts', 'utf8');
const guide = readFileSync('docs/hospitality-payment-history.md', 'utf8');

test('hospitality payment history has deterministic cursor pagination and a hard synchronous ceiling', () => {
  assert.match(history, /HOSPITALITY_PAYMENT_SETTLEMENT_PAGE_SIZE = 100/);
  assert.match(history, /HOSPITALITY_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS = 1_000/);
  assert.match(history, /where: \{ organizationId: input\.organizationId, bookingId: input\.bookingId \}/);
  assert.match(history, /orderBy: \{ id: 'asc' \}/);
  assert.match(history, /cursor: \{ id: cursorId \}/);
  assert.match(history, /take: 1/);
  assert.match(history, /exceeds the \$\{HOSPITALITY_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS\}-transaction reconciliation safety limit/);
});

test('commercial amendment settlement state consumes only complete bounded payment history', () => {
  assert.match(settlement, /readHospitalityPaymentSettlementHistory/);
  assert.match(settlement, /if \(!paymentHistory\.complete\)/);
  assert.match(settlement, /throw new HospitalityBookingConflictError\(paymentHistory\.reason\)/);
  assert.match(settlement, /transactions: paymentHistory\.transactions/);
  assert.doesNotMatch(settlement, /paymentTransaction\.findMany/);
});

test('commercial amendment transport derives settlement and refund allocation from complete bounded history', () => {
  assert.match(transport, /readHospitalityPaymentSettlementHistory/);
  assert.match(transport, /if \(!paymentHistory\.complete\)/);
  assert.match(transport, /const transactions = paymentHistory\.transactions/);
  assert.match(transport, /deriveHospitalityCommercialAmendmentSettlementState\(\{[\s\S]*transactions,/);
  assert.match(transport, /deriveBookingSettlementSummary\(\{ currency: amendment\.currency, transactions \}\)/);
  assert.match(transport, /paymentTransaction\.findMany\(\{[\s\S]*kind: 'REFUND'[\s\S]*status: 'AMBIGUOUS'[\s\S]*take: 2/);
});

test('post-apply-failure recovery requires complete bounded payment history before granting recovery authority', () => {
  assert.match(applyRecovery, /readHospitalityPaymentSettlementHistory/);
  assert.match(applyRecovery, /if \(!paymentHistory\.complete\)/);
  assert.match(applyRecovery, /throw new HospitalityBookingConflictError\(paymentHistory\.reason\)/);
  assert.match(applyRecovery, /transactions: paymentHistory\.transactions/);
  assert.doesNotMatch(applyRecovery, /paymentTransaction\.findMany/);
});

test('expired amendment recovery uses a scoped existence query instead of materializing payment history', () => {
  assert.match(guard, /paymentTransaction\.findFirst/);
  assert.match(guard, /commercialAmendmentId: input\.amendmentId/);
  assert.match(guard, /status: \{ not: 'FAILED' \}/);
  assert.doesNotMatch(guard, /paymentTransaction\.findMany/);
});

test('documentation distinguishes bounded complete money evidence from bounded existence checks', () => {
  assert.match(guide, /100-row cursor pages/i);
  assert.match(guide, /1,000 payment transactions/i);
  assert.match(guide, /fails closed/i);
  assert.match(guide, /existence decisions should query for existence/i);
  assert.match(guide, /money decisions must read complete bounded settlement evidence/i);
  assert.match(guide, /commercial-amendment transport/i);
  assert.match(guide, /post-apply-failure recovery/i);
});
