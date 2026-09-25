import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const reconciliation = read('src/server/payments/hospitality-tax-document-reconciliation-service.ts');
const commercial = read('src/server/payments/hospitality-commercial-adjustment-settlement-reconciliation-service.ts');
const invoiceRead = read('src/server/payments/hospitality-issued-invoice-read-service.ts');
const docs = read('docs/tax-document-reconciliation-read-consistency.md');

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('one repeatable-read transaction owns the full reconciliation report and audit record', () => {
  const scope = between(
    reconciliation,
    'export async function reconcileHospitalityAustralianTaxDocuments',
    'export async function listHospitalityTaxDocumentReconciliationHistory',
  );
  assert.match(scope, /return db\.\$transaction\(async \(transaction\) =>/);
  assert.match(scope, /currentCountsInTransaction\(transaction, input\.organizationId\)/);
  assert.match(scope, /validateTaxInvoiceRegisterInTransaction\(\{\s+transaction,/);
  assert.match(scope, /validateAdjustmentNoteRegisterInTransaction\(\{\s+transaction,/);
  assert.match(scope, /currentCancellationRefundSettlementDriftFailuresInTransaction\(\s+transaction,/);
  assert.match(scope, /currentHospitalityCommercialAdjustmentSettlementDriftFailuresInTransaction\(\{\s+transaction,/);
  assert.match(scope, /await transaction\.auditEvent\.create/);
  assert.match(scope, /isolationLevel: 'RepeatableRead'/);
  assert.doesNotMatch(scope, /currentHospitalityCommercialAdjustmentSettlementDriftFailures\(/);
  assert.doesNotMatch(scope, /db\.auditEvent\.create/);
});

test('register validation pages and validates immutable authority through the caller transaction', () => {
  const invoices = between(
    reconciliation,
    'async function validateTaxInvoiceRegisterInTransaction',
    'async function validateAdjustmentNoteRegisterInTransaction',
  );
  assert.match(invoices, /input\.transaction\.hospitalityIssuedInvoice\.findMany/);
  assert.match(invoices, /organizationId: input\.organizationId/);
  assert.match(invoices, /take: RECONCILIATION_PAGE_SIZE/);
  assert.match(invoices, /validateHospitalityIssuedTaxInvoiceRow\(row\)/);
  assert.doesNotMatch(invoices, /db\./);

  const adjustments = between(
    reconciliation,
    'async function validateAdjustmentNoteRegisterInTransaction',
    'async function currentCancellationRefundSettlementDriftFailuresInTransaction',
  );
  assert.match(adjustments, /input\.transaction\.hospitalityIssuedAdjustmentNote\.findMany/);
  assert.match(adjustments, /validateHospitalityIssuedAdjustmentNoteRowsInTransaction\(\{/);
  assert.match(adjustments, /transaction: input\.transaction/);
  assert.match(adjustments, /organizationId: input\.organizationId/);
  assert.doesNotMatch(adjustments, /db\./);

  assert.match(invoiceRead, /export function validateHospitalityIssuedTaxInvoiceRow/);
});

test('cancellation settlement drift reuses the caller snapshot', () => {
  const scope = between(
    reconciliation,
    'async function currentCancellationRefundSettlementDriftFailuresInTransaction',
    'export async function reconcileHospitalityAustralianTaxDocuments',
  );
  assert.match(scope, /transaction\.hospitalityIssuedAdjustmentNote\.findMany/);
  assert.match(scope, /adjustmentReason: 'BOOKING_CANCELLATION'/);
  assert.match(scope, /take: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT \+ 1/);
  assert.match(scope, /transaction\.paymentTransaction\.findMany/);
  assert.match(scope, /where: \{ organizationId, id: \{ in: refundIds \} \}/);
  assert.doesNotMatch(scope, /db\.\$transaction/);
});

test('commercial settlement drift exposes a transaction-aware core plus standalone snapshot wrapper', () => {
  const core = between(
    commercial,
    'export async function currentHospitalityCommercialAdjustmentSettlementDriftFailuresInTransaction',
    'export async function currentHospitalityCommercialAdjustmentSettlementDriftFailures(input',
  );
  assert.match(core, /transaction: Prisma\.TransactionClient/);
  assert.match(core, /const transaction = input\.transaction/);
  assert.match(core, /transaction\.hospitalityIssuedAdjustmentNote\.findMany/);
  assert.match(core, /transaction\.hospitalityIssuedInvoice\.findMany/);
  assert.match(core, /transaction\.hospitalityBookingCommercialAmendment\.findMany/);
  assert.match(core, /transaction\.hospitalityBookingPricingEvidence\.findMany/);
  assert.match(core, /transaction\.paymentTransaction\.findMany/);
  assert.doesNotMatch(core, /db\.\$transaction/);

  const wrapper = commercial.slice(commercial.indexOf('export async function currentHospitalityCommercialAdjustmentSettlementDriftFailures(input'));
  assert.match(wrapper, /return db\.\$transaction/);
  assert.match(wrapper, /currentHospitalityCommercialAdjustmentSettlementDriftFailuresInTransaction/);
  assert.match(wrapper, /isolationLevel: 'RepeatableRead'/);
});

test('reconciliation history count and page remain snapshot-consistent and deterministic', () => {
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
});

test('documentation defines snapshot semantics without conflating mutable provider truth', () => {
  assert.match(docs, /one caller-owned `RepeatableRead` transaction/);
  assert.match(docs, /reconciliation audit insert all use that same transaction/);
  assert.match(docs, /committed after the reconciliation snapshot starts is intentionally outside that run/);
  assert.match(docs, /historical `CONCURRENT_CHANGE` failure code remains parseable/);
  assert.match(docs, /Current provider lifecycle remains mutable operational truth/);
  assert.match(docs, /performs no live provider calls/);
});
