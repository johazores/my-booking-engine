import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const domain = readFileSync('src/server/payments/rental-payment-domain.ts', 'utf8');
const service = readFileSync('src/server/payments/rental-payment-service.ts', 'utf8');
const history = readFileSync('src/server/payments/rental-payment-history.ts', 'utf8');
const authorityMigration = readFileSync('prisma/migrations/20260916153500_rental_payment_request_evidence/migration.sql', 'utf8');
const clockMigration = readFileSync('prisma/migrations/20260916172000_rental_payment_database_clock/migration.sql', 'utf8');
const partialPaymentMigration = readFileSync('prisma/migrations/20260917180000_rental_partial_manual_payments/migration.sql', 'utf8');
const integration = readFileSync('src/server/payments/rental-payment.integration.ts', 'utf8');
const docs = readFileSync('docs/rental-payment-request-evidence.md', 'utf8');

test('rental payment request fingerprint binds exact tenant settlement authority', () => {
  assert.match(domain, /buildRentalPaymentRequestFingerprint/);
  assert.match(domain, /rental-payment-request-v1/);
  for (const token of ['input.organizationId', 'input.bookingId', 'input.idempotencyKey', 'input.kind', 'input.providerCode', 'input.providerReference', "input.sourceProviderReference ?? ''", 'input.currency', 'input.amountMinor.toString()']) {
    assert.ok(domain.includes(token), `missing fingerprint authority token: ${token}`);
  }
  assert.match(domain, /createHash\('sha256'\)/);
});

test('partial payment amount is parsed, bounded by outstanding authority, and fingerprinted before provider I/O', () => {
  const paymentStart = service.indexOf('export async function recordRentalManualOfflinePayment');
  const refundStart = service.indexOf('export async function recordRentalManualOfflineRefund');
  const paymentService = service.slice(paymentStart, refundStart);
  assert.match(paymentService, /parseOptionalRentalPaymentAmount\(input\.amount, booking\.currency\)/);
  assert.match(paymentService, /paymentAmountMinor > settlement\.outstandingMinor/);
  assert.match(paymentService, /amountMinor: paymentAmountMinor/);
  const expected = paymentService.indexOf('const expectedRequestFingerprint = buildRentalPaymentRequestFingerprint');
  const provider = paymentService.indexOf('const providerResult = await manualProvider.recordOfflinePayment');
  const actual = paymentService.indexOf('const requestFingerprint = buildRentalPaymentRequestFingerprint', provider);
  const insert = paymentService.indexOf('const payment = await transaction.rentalPaymentTransaction.create', actual);
  assert.ok(expected >= 0 && provider > expected && actual > provider && insert > actual);
});

test('partial refund amount is server-planned, source-bound, and fingerprinted before provider I/O', () => {
  const refundFunctionStart = service.indexOf('export async function recordRentalManualOfflineRefund');
  const listFunctionStart = service.indexOf('export async function listRentalBookingPaymentTransactions');
  const refundService = service.slice(refundFunctionStart, listFunctionStart);
  assert.match(service, /parseMoneyMajorToMinor\(normalized, currency\)/);
  assert.match(refundService, /const requestedAmountMinor = parseOptionalRentalRefundAmount\(input\.amount, booking\.currency\)/);
  assert.match(refundService, /requestedAmountMinor,/);
  const planIndex = refundService.indexOf('const plan = deriveBookingRefundExecutionPlan');
  const expectedFingerprintIndex = refundService.indexOf('const expectedRequestFingerprint = buildRentalPaymentRequestFingerprint', planIndex);
  const providerCallIndex = refundService.indexOf('const providerResult = await manualProvider.recordOfflineRefund');
  const actualFingerprintIndex = refundService.indexOf('const requestFingerprint = buildRentalPaymentRequestFingerprint', providerCallIndex);
  const insertIndex = refundService.indexOf('const refund = await transaction.rentalPaymentTransaction.create', actualFingerprintIndex);
  assert.ok(planIndex >= 0 && expectedFingerprintIndex > planIndex && providerCallIndex > expectedFingerprintIndex && actualFingerprintIndex > providerCallIndex && insertIndex > actualFingerprintIndex);
  assert.match(refundService, /providerResult\.money\.amountMinor !== plan\.amountMinor/);
});

test('idempotent payment and partial refund replay remain exact across later settlement transitions', () => {
  assert.match(service, /requestedAmountMinor !== null && existing\.amountMinor !== requestedAmountMinor/);
  assert.match(service, /const sourceExists = history\.some/);
  assert.match(service, /if \(!sourceExists \|\| !settlement\.reconciled\)/);
  assert.match(integration, /partialPaymentReplay/);
  assert.match(integration, /partialReplayAfterFullRefund/);
  assert.match(integration, /partialRefundReplayAfterCancellation/);
  assert.match(integration, /replayAfterCancellation/);
  assert.match(integration, /different durable settlement evidence/i);
});

test('bounded settlement history still revalidates deterministic evidence and database chronology', () => {
  assert.match(history, /organizationId: true/);
  assert.match(history, /bookingId: true/);
  assert.match(history, /idempotencyKey: true/);
  assert.match(history, /requestFingerprint: true/);
  assert.match(history, /buildRentalPaymentIdempotencyKey/);
  assert.match(history, /buildRentalPaymentRequestFingerprint/);
  assert.match(history, /invalid deterministic idempotency authority/);
  assert.match(history, /invalid request fingerprint/);
  assert.match(history, /if \(row\.requestFingerprint === null\) return null/);
});

test('database requires request evidence shape, database-authored time, and net outstanding payment authority', () => {
  assert.match(authorityMigration, /sf_guard_rental_payment_request_evidence/);
  assert.match(authorityMigration, /NEW\."requestFingerprint" IS NULL/);
  assert.match(authorityMigration, /\^rental:manual-payment:\[a-f0-9\]\{48\}\$/);
  assert.match(authorityMigration, /\^rental:manual-refund:\[a-f0-9\]\{48\}\$/);
  assert.match(clockMigration, /NEW\."createdAt" := clock_timestamp\(\)/);
  assert.match(partialPaymentMigration, /net_settled_minor \+ NEW\."amountMinor" > parent_booking\."totalMinor"/);
});

test('documentation describes exact partial payment/refund authority without implying provider-backed checkout', () => {
  assert.match(docs, /partial or full booking-price payments/i);
  assert.match(docs, /major-unit payment amount/i);
  assert.match(docs, /current net outstanding-balance limits/i);
  assert.match(docs, /partial payment remains replayable/i);
  assert.match(docs, /Rows predating request fingerprints may retain `requestFingerprint = NULL`/);
  assert.match(docs, /`clock_timestamp\(\)`/);
  assert.match(docs, /does not add Stripe rental checkout/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
