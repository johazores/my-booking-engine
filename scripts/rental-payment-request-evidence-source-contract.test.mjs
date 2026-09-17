import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const domain = readFileSync('src/server/payments/rental-payment-domain.ts', 'utf8');
const service = readFileSync('src/server/payments/rental-payment-service.ts', 'utf8');
const history = readFileSync('src/server/payments/rental-payment-history.ts', 'utf8');
const authorityMigration = readFileSync('prisma/migrations/20260916153500_rental_payment_request_evidence/migration.sql', 'utf8');
const clockMigration = readFileSync('prisma/migrations/20260916172000_rental_payment_database_clock/migration.sql', 'utf8');
const integration = readFileSync('src/server/payments/rental-payment.integration.ts', 'utf8');
const docs = readFileSync('docs/rental-payment-request-evidence.md', 'utf8');

test('rental payment request fingerprint binds exact tenant settlement authority', () => {
  assert.match(domain, /buildRentalPaymentRequestFingerprint/);
  assert.match(domain, /rental-payment-request-v1/);
  for (const token of [
    'input.organizationId',
    'input.bookingId',
    'input.idempotencyKey',
    'input.kind',
    'input.providerCode',
    'input.providerReference',
    "input.sourceProviderReference ?? ''",
    'input.currency',
    'input.amountMinor.toString()',
  ]) assert.ok(domain.includes(token), `missing fingerprint authority token: ${token}`);
  assert.match(domain, /createHash\('sha256'\)/);
});

test('partial refund amount is parsed server-side and bound to the selected source before provider I/O', () => {
  const refundFunctionStart = service.indexOf('export async function recordRentalManualOfflineRefund');
  const listFunctionStart = service.indexOf('export async function listRentalBookingPaymentTransactions');
  assert.ok(refundFunctionStart >= 0 && listFunctionStart > refundFunctionStart);
  const refundService = service.slice(refundFunctionStart, listFunctionStart);

  assert.match(service, /parseMoneyMajorToMinor\(normalized, currency\)/);
  assert.match(refundService, /const requestedAmountMinor = parseOptionalRentalRefundAmount\(input\.amount, booking\.currency\)/);
  assert.match(refundService, /requestedAmountMinor,/);

  const planIndex = refundService.indexOf('const plan = deriveBookingRefundExecutionPlan');
  const expectedFingerprintIndex = refundService.indexOf('const expectedRequestFingerprint = buildRentalPaymentRequestFingerprint', planIndex);
  const providerCallIndex = refundService.indexOf('const providerResult = await manualProvider.recordOfflineRefund');
  const actualFingerprintIndex = refundService.indexOf('const requestFingerprint = buildRentalPaymentRequestFingerprint', providerCallIndex);
  const comparisonIndex = refundService.indexOf('requestFingerprint !== expectedRequestFingerprint', actualFingerprintIndex);
  const insertIndex = refundService.indexOf('const refund = await transaction.rentalPaymentTransaction.create', comparisonIndex);

  assert.ok(planIndex >= 0);
  assert.ok(expectedFingerprintIndex > planIndex);
  assert.ok(providerCallIndex > expectedFingerprintIndex);
  assert.ok(actualFingerprintIndex > providerCallIndex);
  assert.ok(comparisonIndex > actualFingerprintIndex);
  assert.ok(insertIndex > comparisonIndex);
  assert.match(refundService, /amountMinor: plan\.amountMinor/);
  assert.match(refundService, /providerResult\.money\.amountMinor !== plan\.amountMinor/);
});

test('idempotent partial refund replay binds a supplied amount but remains valid across later settlement transitions', () => {
  assert.match(service, /requestedAmountMinor !== null && existing\.amountMinor !== requestedAmountMinor/);
  assert.match(service, /const sourceExists = history\.some/);
  assert.match(service, /if \(!sourceExists \|\| !settlement\.reconciled\)/);
  assert.doesNotMatch(service, /settlement\.paymentState !== 'REFUNDED'[\s\S]*idempotent replay/);
  assert.match(integration, /const partialRefundReplay = await payments\.recordRentalManualOfflineRefund/);
  assert.match(integration, /const partialReplayAfterFullRefund = await payments\.recordRentalManualOfflineRefund/);
  assert.match(integration, /const partialRefundReplayAfterCancellation = await payments\.recordRentalManualOfflineRefund/);
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

test('database continues to require request evidence shape, operation namespace, and database-authored time', () => {
  assert.match(authorityMigration, /sf_guard_rental_payment_request_evidence/);
  assert.match(authorityMigration, /NEW\."requestFingerprint" IS NULL/);
  assert.match(authorityMigration, /\^rental:manual-payment:\[a-f0-9\]\{48\}\$/);
  assert.match(authorityMigration, /\^rental:manual-refund:\[a-f0-9\]\{48\}\$/);
  assert.match(clockMigration, /NEW\."createdAt" := clock_timestamp\(\)/);
  assert.doesNotMatch(clockMigration, /NEW\."createdAt" IS DISTINCT FROM CURRENT_TIMESTAMP/);
});

test('documentation preserves legacy compatibility while describing exact requested partial-refund authority', () => {
  assert.match(docs, /partial or full refunds/i);
  assert.match(docs, /staff may provide a major-unit refund amount/i);
  assert.match(docs, /source and exact minor-unit amount are bound/i);
  assert.match(docs, /partial refund remains replayable while the booking is still `PARTIALLY_REFUNDED`/);
  assert.match(docs, /Rows predating request fingerprints may retain `requestFingerprint = NULL`/);
  assert.match(docs, /`clock_timestamp\(\)`/);
  assert.match(docs, /does not add Stripe rental checkout, deposits, split tenders/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
