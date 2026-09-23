import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const history = readFileSync('src/server/payments/hospitality-payment-history.ts', 'utf8');
const settlement = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-settlement-service.ts', 'utf8');
const guard = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-guard.ts', 'utf8');
const transport = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-transport-service.ts', 'utf8');
const apply = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-apply-service.ts', 'utf8');
const applyRecovery = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-apply-recovery-service.ts', 'utf8');
const amendmentPreparation = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-service.ts', 'utf8');
const manualSettlement = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-manual-settlement-service.ts', 'utf8');
const stripeRefund = readFileSync('src/server/bookings/hospitality-booking-commercial-amendment-stripe-refund-service.ts', 'utf8');
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

test('commercial amendment apply refuses to mutate booking terms from incomplete payment history', () => {
  assert.match(apply, /readHospitalityPaymentSettlementHistory/);
  assert.match(apply, /if \(!paymentHistory\.complete\) throw new HospitalityBookingConflictError\(paymentHistory\.reason\)/);
  assert.match(apply, /const transactions = paymentHistory\.transactions/);
  assert.match(apply, /deriveHospitalityCommercialAmendmentSettlementState\(\{[\s\S]*transactions,/);
  assert.doesNotMatch(apply, /paymentTransaction\.findMany/);

  const completeHistoryIndex = apply.indexOf('if (!paymentHistory.complete)');
  const bookingMutationIndex = apply.indexOf('const updatedBooking = await transaction.hospitalityBooking.update');
  assert.ok(completeHistoryIndex >= 0 && bookingMutationIndex >= 0 && completeHistoryIndex < bookingMutationIndex);
});

test('post-apply-failure recovery requires complete bounded payment history before granting recovery authority', () => {
  assert.match(applyRecovery, /readHospitalityPaymentSettlementHistory/);
  assert.match(applyRecovery, /if \(!paymentHistory\.complete\)/);
  assert.match(applyRecovery, /throw new HospitalityBookingConflictError\(paymentHistory\.reason\)/);
  assert.match(applyRecovery, /transactions: paymentHistory\.transactions/);
  assert.doesNotMatch(applyRecovery, /paymentTransaction\.findMany/);
});

test('commercial amendment preparation fails closed on incomplete payment history', () => {
  assert.match(amendmentPreparation, /readHospitalityPaymentSettlementHistory/);
  assert.match(amendmentPreparation, /if \(!paymentHistory\.complete\)/);
  assert.match(amendmentPreparation, /throw new HospitalityBookingConflictError\(paymentHistory\.reason\)/);
  assert.match(amendmentPreparation, /transactions: paymentHistory\.transactions/);
  assert.doesNotMatch(amendmentPreparation, /paymentTransaction\.findMany/);
});

test('manual amendment money movement derives execution only from complete bounded history', () => {
  assert.match(manualSettlement, /readHospitalityPaymentSettlementHistory/);
  assert.match(manualSettlement, /if \(!paymentHistory\.complete\)/);
  assert.match(manualSettlement, /const ledger = paymentHistory\.transactions/);
  assert.match(manualSettlement, /deriveDecision\(\{ amendment, transactions: ledger, now \}\)/);
  assert.doesNotMatch(manualSettlement, /paymentTransaction\.findMany/);
});

test('Stripe amendment refund claims use bounded history without penalizing terminal idempotent reads', () => {
  assert.match(stripeRefund, /readHospitalityPaymentSettlementHistory/);
  assert.match(stripeRefund, /if \(!paymentHistory\.complete\)/);
  assert.match(stripeRefund, /transactions: paymentHistory\.transactions\.filter\(\(entry\) => entry\.id !== existing\.id\)/);
  assert.match(stripeRefund, /deriveExecution\(\{ amendment, transactions: paymentHistory\.transactions, now \}\)/);
  assert.doesNotMatch(stripeRefund, /paymentTransaction\.findMany/);

  const terminalIdempotentBranch = stripeRefund.indexOf("if (existing.status !== 'AMBIGUOUS')");
  const providerBoundBranch = stripeRefund.indexOf('if (!isInternalPaymentClaimReference(existing.providerReference))');
  const firstBoundedRead = stripeRefund.indexOf('const paymentHistory = await readHospitalityPaymentSettlementHistory', terminalIdempotentBranch);
  assert.ok(terminalIdempotentBranch >= 0 && terminalIdempotentBranch < firstBoundedRead);
  assert.ok(providerBoundBranch >= 0 && providerBoundBranch < firstBoundedRead);
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
  assert.match(guide, /commercial-amendment apply/i);
  assert.match(guide, /post-apply-failure recovery/i);
  assert.match(guide, /commercial-amendment preparation/i);
  assert.match(guide, /manual settlement writer/i);
  assert.match(guide, /Stripe amendment refunds/i);
});
