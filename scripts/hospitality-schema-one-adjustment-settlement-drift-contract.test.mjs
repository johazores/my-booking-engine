import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const issuance = read('src/server/payments/hospitality-adjustment-note-service.ts');
const authority = read('src/server/payments/hospitality-issued-adjustment-note-authority-service.ts');
const reconciliation = read('src/server/payments/hospitality-tax-document-reconciliation-service.ts');
const reconciliationDomain = read('src/server/payments/hospitality-tax-document-reconciliation-domain.ts');
const settlementDriftDomain = read('src/server/payments/hospitality-tax-document-settlement-drift-domain.ts');
const reconciliationPage = read('app/invoices/reconciliation/page.tsx');
const docs = read('docs/tax-document-retention-and-reconciliation.md');

test('schema-one issuance still requires successful exact refund authority', () => {
  assert.match(issuance, /commercialAmendmentId: null,[\s\S]*kind: 'REFUND' as const,[\s\S]*status: 'SUCCEEDED' as const/);
  assert.match(issuance, /sourceProviderReference: \{ not: null \}/);
  assert.match(issuance, /isolationLevel: 'Serializable'/);
});

test('immutable schema-one reads do not depend on mutable current refund status', () => {
  assert.match(authority, /refund\.kind !== 'REFUND'/);
  assert.match(authority, /refund\.currency !== item\.document\.currency/);
  assert.match(authority, /refund\.sourceProviderReference === null/);
  assert.doesNotMatch(authority, /refund\.status/);
});

test('reconciliation maps only fingerprint-verified schema-one and schema-six refund identities to current drift', () => {
  assert.match(reconciliation, /adjustmentReason: 'BOOKING_CANCELLATION'/);
  assert.match(reconciliation, /parseHospitalityIssuedCancellationAdjustmentNoteSnapshot/);
  assert.match(reconciliation, /hospitalityIssuedAdjustmentNoteFingerprint\(snapshot\) !== row\.documentFingerprint/);
  assert.match(reconciliation, /parseHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot/);
  assert.match(reconciliation, /hospitalityIssuedCancellationAfterAmendmentAdjustmentNoteFingerprint\(snapshot\) !== row\.documentFingerprint/);
  assert.match(reconciliation, /snapshot\.refundAuthorities\.map\(\(authority\) => authority\.refundTransactionId\)/);
  assert.match(reconciliation, /findHospitalityTaxDocumentSettlementDrift/);
  assert.match(reconciliation, /documentNumber: item\.documentNumber/);
  assert.match(settlementDriftDomain, /currentStatus !== undefined && currentStatus !== 'SUCCEEDED'/);
  assert.match(settlementDriftDomain, /Missing rows are source\/integrity failures/);
});

test('reconciliation audit history preserves safe occurrence counts without legal-document identifiers', () => {
  assert.match(reconciliationDomain, /schemaVersion: 2 as const/);
  assert.match(reconciliationDomain, /failureCounts: canonicalFailureCounts/);
  assert.match(reconciliationDomain, /failureCounts: null/);
  assert.match(reconciliation, /failureCounts: auditData\.failureCounts\.map/);
  assert.match(reconciliationPage, /report\.failureCounts/);
  assert.match(reconciliationPage, /occurrence\$\{count === 1 \? '' : 's'\}/);
  assert.match(docs, /deliberately excludes document numbers/i);
});

test('documentation separates historical legal evidence from current provider lifecycle', () => {
  assert.match(docs, /historical issuance authority from mutable current provider settlement/i);
  assert.match(docs, /schema-version-6 cancellation-after-amendment snapshots already freeze an ordered set/i);
  assert.match(docs, /Missing refund rows remain source\/integrity failures/i);
  assert.match(docs, /Commercial-amendment schemas 2 through 5 still need a versioned issue-time settlement-evidence contract/i);
});
