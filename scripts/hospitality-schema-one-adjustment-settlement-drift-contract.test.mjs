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

test('reconciliation reports current schema-one refund settlement drift separately', () => {
  assert.match(reconciliation, /refundTransactionId: \{ not: null \}/);
  assert.match(reconciliation, /select: \{ id: true, status: true \}/);
  assert.match(reconciliation, /statusById\.get\(refundId\) !== 'SUCCEEDED'/);
  assert.match(reconciliation, /code: 'SETTLEMENT_DRIFT'/);
  assert.match(reconciliationDomain, /'SETTLEMENT_DRIFT'/);
  assert.match(reconciliationPage, /code === 'SETTLEMENT_DRIFT'/);
});

test('documentation separates historical legal evidence from current provider lifecycle', () => {
  assert.match(docs, /historical issuance authority from mutable current provider settlement/i);
  assert.match(docs, /records `SETTLEMENT_DRIFT`/);
  assert.match(docs, /does not rewrite or hide the issued adjustment note/i);
  assert.match(docs, /schema-version-6 documents still require a deliberate versioned issue-time settlement-evidence design/i);
});
