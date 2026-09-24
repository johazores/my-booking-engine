import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const reconciliation = read('src/server/payments/hospitality-tax-document-reconciliation-service.ts');
const commercial = read('src/server/payments/hospitality-commercial-adjustment-settlement-reconciliation-service.ts');
const docs = read('docs/tax-document-reconciliation-read-consistency.md');

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('Australian legal-document counts are internally snapshot-consistent', () => {
  const scope = between(reconciliation, 'async function currentCounts', 'async function validateTaxInvoiceRegister');
  assert.match(scope, /return db\.\$transaction\(async \(transaction\) =>/);
  assert.match(scope, /transaction\.hospitalityIssuedInvoice\.count/);
  assert.match(scope, /transaction\.hospitalityIssuedAdjustmentNote\.count/);
  assert.match(scope, /organizationId, jurisdictionCode: 'AU', documentType: 'TAX_INVOICE'/);
  assert.match(scope, /organizationId, jurisdictionCode: 'AU', documentType: 'ADJUSTMENT_NOTE'/);
  assert.match(scope, /isolationLevel: 'RepeatableRead'/);
  assert.doesNotMatch(scope, /db\.hospitalityIssued(?:Invoice|AdjustmentNote)\.count/);
});

test('cancellation settlement drift reads legal authority and current refund status in one snapshot', () => {
  const scope = between(reconciliation, 'async function currentCancellationRefundSettlementDriftFailures', 'export async function reconcileHospitalityAustralianTaxDocuments');
  assert.match(scope, /return db\.\$transaction\(async \(transaction\) =>/);
  assert.match(scope, /transaction\.hospitalityIssuedAdjustmentNote\.findMany/);
  assert.match(scope, /adjustmentReason: 'BOOKING_CANCELLATION'/);
  assert.match(scope, /take: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT \+ 1/);
  assert.match(scope, /transaction\.paymentTransaction\.findMany/);
  assert.match(scope, /where: \{ organizationId, id: \{ in: refundIds \} \}/);
  assert.match(scope, /isolationLevel: 'RepeatableRead'/);
  assert.doesNotMatch(scope, /db\.(?:hospitalityIssuedAdjustmentNote|paymentTransaction)\.findMany/);
});

test('commercial settlement drift observes legal and payment evidence in one bounded snapshot', () => {
  const scope = commercial.slice(commercial.indexOf('export async function currentHospitalityCommercialAdjustmentSettlementDriftFailures'));
  assert.match(scope, /return db\.\$transaction\(async \(transaction\) =>/);
  assert.match(scope, /transaction\.hospitalityIssuedAdjustmentNote\.findMany/);
  assert.match(scope, /adjustmentReason: 'COMMERCIAL_AMENDMENT'/);
  assert.match(scope, /take: input\.documentLimit \+ 1/);
  assert.match(scope, /transaction\.hospitalityIssuedInvoice\.findMany/);
  assert.match(scope, /transaction\.hospitalityBookingCommercialAmendment\.findMany/);
  assert.match(scope, /transaction\.hospitalityBookingPricingEvidence\.findMany/);
  assert.match(scope, /transaction\.paymentTransaction\.findMany/);
  assert.match(scope, /take: COMMERCIAL_SETTLEMENT_TRANSACTION_LIMIT \+ 1/);
  assert.match(scope, /isolationLevel: 'RepeatableRead'/);
  assert.doesNotMatch(scope, /db\.(?:hospitalityIssuedAdjustmentNote|hospitalityIssuedInvoice|hospitalityBookingCommercialAmendment|hospitalityBookingPricingEvidence|paymentTransaction)\.findMany/);
});

test('reconciliation history count and page are snapshot-consistent and deterministic', () => {
  const scope = reconciliation.slice(reconciliation.indexOf('export async function listHospitalityTaxDocumentReconciliationHistory'));
  assert.match(scope, /return db\.\$transaction\(async \(transaction\) =>/);
  assert.match(scope, /transaction\.auditEvent\.count\(\{ where \}\)/);
  assert.match(scope, /const totalPages = Math\.max\(1, Math\.ceil\(total \/ pageSize\)\)/);
  assert.match(scope, /const page = Math\.min\(requestedPage, totalPages\)/);
  assert.match(scope, /transaction\.auditEvent\.findMany/);
  assert.match(scope, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/);
  assert.match(scope, /skip: \(page - 1\) \* pageSize/);
  assert.match(scope, /take: pageSize/);
  assert.match(scope, /isolationLevel: 'RepeatableRead'/);
  assert.doesNotMatch(scope, /db\.auditEvent\.(?:count|findMany)/);
});

test('documentation preserves the legal-evidence boundary', () => {
  assert.match(docs, /internally consistent PostgreSQL state/);
  assert.match(docs, /separate count snapshot before and after/);
  assert.match(docs, /do not turn mutable payment-provider status into immutable legal evidence/);
  assert.match(docs, /schemas 2 through 5 still require a deliberate versioned issue-time settlement-evidence contract/);
  assert.match(docs, /bounded multi-stage application scan/);
});
