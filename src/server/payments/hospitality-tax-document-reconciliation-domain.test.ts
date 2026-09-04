import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY,
  HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT,
  createHospitalityTaxDocumentReconciliationResult,
} from './hospitality-tax-document-reconciliation-domain.ts';

test('retention policy never enables automatic legal-document deletion', () => {
  assert.equal(AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY.jurisdictionCode, 'AU');
  assert.equal(AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY.automaticDeletion, false);
  assert.equal(AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY.mode, 'INDEFINITE');
  assert.equal(AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY.minimumRecordYears, 5);
});

test('successful reconciliation reports exact document counts', () => {
  const result = createHospitalityTaxDocumentReconciliationResult({
    checkedAt: new Date('2026-09-04T00:00:00.000Z'),
    taxInvoiceCount: 4,
    adjustmentNoteCount: 2,
  });
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.totalDocumentCount, 6);
  assert.equal(result.failures.length, 0);
});

test('integrity failures prevent a verified result', () => {
  const result = createHospitalityTaxDocumentReconciliationResult({
    checkedAt: new Date('2026-09-04T00:00:00.000Z'),
    taxInvoiceCount: 1,
    adjustmentNoteCount: 1,
    failures: [{ documentType: 'ADJUSTMENT_NOTE', documentNumber: 'AU-ADJ-00000001', code: 'SOURCE_LINK_FAILED' }],
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failures.length, 1);
});

test('synchronous reconciliation bound remains finite', () => {
  assert.equal(HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT, 5_000);
  assert.throws(() => createHospitalityTaxDocumentReconciliationResult({
    checkedAt: new Date('invalid'),
    taxInvoiceCount: 0,
    adjustmentNoteCount: 0,
  }), /checkedAt/);
});
