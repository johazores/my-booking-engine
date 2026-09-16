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
  ]) {
    assert.ok(domain.includes(token), `missing fingerprint authority token: ${token}`);
  }
  assert.match(domain, /createHash\('sha256'\)/);
});

test('manual payment and refund writers persist fingerprints and validate retained replay evidence', () => {
  assert.match(service, /buildRentalPaymentRequestFingerprint/);
  assert.match(service, /kind: 'OFFLINE_PAYMENT'/);
  assert.match(service, /kind: 'REFUND'/);
  assert.match(service, /requestFingerprint,/);
  assert.match(service, /existing\.requestFingerprint !== null && existing\.requestFingerprint !== expectedRequestFingerprint/);
  assert.match(service, /Manual payment provider result changed the durable rental payment request identity/);
  assert.match(service, /Manual refund provider result changed the durable rental refund request identity/);
  assert.match(service, /where: \{ id: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(service, /isolationLevel: 'Serializable'/);
});

test('fresh manual refund authority is bound before provider I/O and reverified before persistence', () => {
  const refundFunctionStart = service.indexOf('export async function recordRentalManualOfflineRefund');
  const listFunctionStart = service.indexOf('export async function listRentalBookingPaymentTransactions');
  assert.ok(refundFunctionStart >= 0 && listFunctionStart > refundFunctionStart);
  const refundService = service.slice(refundFunctionStart, listFunctionStart);

  const planIndex = refundService.indexOf('const plan = deriveBookingRefundExecutionPlan');
  const expectedFingerprintIndex = refundService.indexOf('const expectedRequestFingerprint = buildRentalPaymentRequestFingerprint', planIndex);
  const providerCallIndex = refundService.indexOf('const providerResult = await manualProvider.recordOfflineRefund');
  const actualFingerprintIndex = refundService.indexOf('const requestFingerprint = buildRentalPaymentRequestFingerprint', providerCallIndex);
  const comparisonIndex = refundService.indexOf('requestFingerprint !== expectedRequestFingerprint', actualFingerprintIndex);
  const insertIndex = refundService.indexOf('const refund = await transaction.rentalPaymentTransaction.create', comparisonIndex);

  assert.ok(planIndex >= 0, 'refund execution plan must be derived from reconciled history');
  assert.ok(expectedFingerprintIndex > planIndex, 'expected refund fingerprint must be built from the selected refund plan');
  assert.ok(providerCallIndex > expectedFingerprintIndex, 'expected refund authority must be bound before provider I/O');
  assert.ok(actualFingerprintIndex > providerCallIndex, 'provider result fingerprint must be rebuilt after provider I/O');
  assert.ok(comparisonIndex > actualFingerprintIndex, 'provider result identity must be compared with pre-provider authority');
  assert.ok(insertIndex > comparisonIndex, 'refund persistence must happen only after request identity verification');
  assert.match(refundService, /providerResult\.providerCode !== manualProvider\.code/);
  assert.match(refundService, /sourceProviderReference: plan\.sourceProviderReference/);
  assert.match(refundService, /sourceProviderReference: providerResult\.providerReference/);
});

test('bounded settlement history revalidates deterministic request evidence before financial decisions', () => {
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

test('database requires request evidence shape and operation idempotency namespace', () => {
  assert.match(authorityMigration, /sf_guard_rental_payment_request_evidence/);
  assert.match(authorityMigration, /NEW\."requestFingerprint" IS NULL/);
  assert.match(authorityMigration, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(authorityMigration, /\^rental:manual-payment:\[a-f0-9\]\{48\}\$/);
  assert.match(authorityMigration, /\^rental:manual-refund:\[a-f0-9\]\{48\}\$/);
  assert.match(authorityMigration, /rental_payment_transactions_authority_guard/);
});

test('database authors rental settlement insertion chronology from its wall clock', () => {
  assert.match(clockMigration, /CREATE OR REPLACE FUNCTION sf_guard_rental_payment_request_evidence/);
  assert.match(clockMigration, /NEW\."createdAt" := clock_timestamp\(\)/);
  assert.doesNotMatch(clockMigration, /NEW\."createdAt" IS DISTINCT FROM CURRENT_TIMESTAMP/);
  assert.match(clockMigration, /NEW\."requestFingerprint" IS NULL/);
  assert.match(clockMigration, /\^rental:manual-payment:\[a-f0-9\]\{48\}\$/);
  assert.match(clockMigration, /\^rental:manual-refund:\[a-f0-9\]\{48\}\$/);
});

test('guarded PostgreSQL scenario covers direct-write request-evidence rejection, database-authored chronology, and refund replay integrity', () => {
  assert.match(integration, /NO-FP-/);
  assert.match(integration, /request fingerprint/i);
  assert.match(integration, /BAD-KEY-/);
  assert.match(integration, /idempotency key/i);
  assert.match(integration, /CLOCK-PROBE-/);
  assert.match(integration, /callerAuthoredCreatedAt/);
  assert.match(integration, /clock_timestamp\(\) AS "databaseNow"/);
  assert.match(integration, /ROLLBACK_RENTAL_PAYMENT_CLOCK_PROBE/);
  assert.match(integration, /payment\.transaction\.requestFingerprint/);
  assert.match(integration, /refund\.transaction\.requestFingerprint/);
  assert.match(integration, /const refundReplay = await payments\.recordRentalManualOfflineRefund/);
  assert.match(integration, /const refundReplayAfterCancellation = await payments\.recordRentalManualOfflineRefund/);
  assert.match(integration, /refundReplayAfterCancellation\.transaction\.requestFingerprint/);
});

test('documentation preserves legacy replay compatibility without expanding rental payment capability', () => {
  assert.match(docs, /Rows created before this migration may legitimately have `requestFingerprint = NULL`/);
  assert.match(docs, /New rows cannot use that legacy path/);
  assert.match(docs, /same two-sided authority check/);
  assert.match(docs, /replayable after the booking is later cancelled/);
  assert.match(docs, /`clock_timestamp\(\)`/);
  assert.match(docs, /caller-supplied `createdAt` values are overwritten/i);
  assert.match(docs, /does not add Stripe rental checkout, deposits, split tenders/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
