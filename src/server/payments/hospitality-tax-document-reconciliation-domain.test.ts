import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY,
  HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_AUDIT_ACTION,
  HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT,
  createHospitalityTaxDocumentReconciliationAuditData,
  createHospitalityTaxDocumentReconciliationResult,
  parseHospitalityTaxDocumentReconciliationAuditData,
} from './hospitality-tax-document-reconciliation-domain.ts';

test('retention policy never infers legal-document disposal authority from age alone', () => {
  assert.equal(AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY.jurisdictionCode, 'AU');
  assert.equal(AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY.automaticDeletion, false);
  assert.equal(AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY.mode, 'NO_AUTOMATIC_DELETION');
  assert.equal(AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY.minimumRecordYears, 5);
  assert.equal(AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY.disposalRequiresLegalReview, true);
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

test('reconciliation audit data is secret-safe, canonical, and round-trips', () => {
  const result = createHospitalityTaxDocumentReconciliationResult({
    checkedAt: new Date('2026-09-04T01:02:03.000Z'),
    taxInvoiceCount: 3,
    adjustmentNoteCount: 2,
    failures: [
      { documentType: 'REGISTER', documentNumber: null, code: 'CONCURRENT_CHANGE' },
      { documentType: 'ADJUSTMENT_NOTE', documentNumber: 'AU-ADJ-00000009', code: 'SOURCE_LINK_FAILED' },
      { documentType: 'REGISTER', documentNumber: null, code: 'CONCURRENT_CHANGE' },
    ],
  });
  const audit = createHospitalityTaxDocumentReconciliationAuditData(result);
  assert.equal(HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_AUDIT_ACTION, 'payment.tax-document-reconciliation.completed');
  assert.deepEqual(audit.failureCodes, ['CONCURRENT_CHANGE', 'SOURCE_LINK_FAILED']);
  assert.equal('documentNumber' in audit, false);
  assert.equal(JSON.stringify(audit).includes('AU-ADJ-00000009'), false);

  const parsed = parseHospitalityTaxDocumentReconciliationAuditData(audit);
  assert.ok(parsed);
  assert.equal(parsed.status, 'FAILED');
  assert.equal(parsed.checkedAt.toISOString(), '2026-09-04T01:02:03.000Z');
  assert.equal(parsed.totalDocumentCount, 5);
});

test('malformed or contradictory reconciliation audit data fails closed', () => {
  assert.equal(parseHospitalityTaxDocumentReconciliationAuditData(null), null);
  assert.equal(parseHospitalityTaxDocumentReconciliationAuditData({
    schemaVersion: 1,
    jurisdictionCode: 'AU',
    status: 'VERIFIED',
    checkedAt: '2026-09-04T00:00:00.000Z',
    taxInvoiceCount: 1,
    adjustmentNoteCount: 1,
    totalDocumentCount: 2,
    failureCodes: ['SOURCE_LINK_FAILED'],
  }), null);
  assert.equal(parseHospitalityTaxDocumentReconciliationAuditData({
    schemaVersion: 1,
    jurisdictionCode: 'AU',
    status: 'FAILED',
    checkedAt: 'not-a-date',
    taxInvoiceCount: 1,
    adjustmentNoteCount: 0,
    totalDocumentCount: 1,
    failureCodes: ['SOURCE_LINK_FAILED'],
  }), null);
});

test('synchronous reconciliation bound remains finite', () => {
  assert.equal(HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT, 5_000);
  assert.throws(() => createHospitalityTaxDocumentReconciliationResult({
    checkedAt: new Date('invalid'),
    taxInvoiceCount: 0,
    adjustmentNoteCount: 0,
  }), /checkedAt/);
});
