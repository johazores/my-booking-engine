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

test('integrity and current settlement failures prevent a verified result', () => {
  const result = createHospitalityTaxDocumentReconciliationResult({
    checkedAt: new Date('2026-09-04T00:00:00.000Z'),
    taxInvoiceCount: 1,
    adjustmentNoteCount: 2,
    failures: [
      { documentType: 'ADJUSTMENT_NOTE', documentNumber: 'AU-ADJ-00000001', code: 'SOURCE_LINK_FAILED' },
      { documentType: 'ADJUSTMENT_NOTE', documentNumber: 'AU-ADJ-00000002', code: 'SETTLEMENT_DRIFT' },
    ],
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failures.length, 2);
});

test('reconciliation audit v2 stores secret-safe canonical failure counts and round-trips', () => {
  const result = createHospitalityTaxDocumentReconciliationResult({
    checkedAt: new Date('2026-09-04T01:02:03.000Z'),
    taxInvoiceCount: 3,
    adjustmentNoteCount: 3,
    failures: [
      { documentType: 'REGISTER', documentNumber: null, code: 'CONCURRENT_CHANGE' },
      { documentType: 'ADJUSTMENT_NOTE', documentNumber: 'AU-ADJ-00000009', code: 'SOURCE_LINK_FAILED' },
      { documentType: 'ADJUSTMENT_NOTE', documentNumber: 'AU-ADJ-00000010', code: 'SETTLEMENT_DRIFT' },
      { documentType: 'ADJUSTMENT_NOTE', documentNumber: 'AU-ADJ-00000011', code: 'SETTLEMENT_DRIFT' },
      { documentType: 'REGISTER', documentNumber: null, code: 'CONCURRENT_CHANGE' },
    ],
  });
  const audit = createHospitalityTaxDocumentReconciliationAuditData(result);
  assert.equal(HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_AUDIT_ACTION, 'payment.tax-document-reconciliation.completed');
  assert.equal(audit.schemaVersion, 2);
  assert.deepEqual(audit.failureCodes, ['CONCURRENT_CHANGE', 'SETTLEMENT_DRIFT', 'SOURCE_LINK_FAILED']);
  assert.deepEqual(audit.failureCounts, [
    { code: 'CONCURRENT_CHANGE', count: 2 },
    { code: 'SETTLEMENT_DRIFT', count: 2 },
    { code: 'SOURCE_LINK_FAILED', count: 1 },
  ]);
  assert.equal('documentNumber' in audit, false);
  assert.equal(JSON.stringify(audit).includes('AU-ADJ-00000009'), false);
  assert.equal(JSON.stringify(audit).includes('AU-ADJ-00000010'), false);

  const parsed = parseHospitalityTaxDocumentReconciliationAuditData(audit);
  assert.ok(parsed);
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.status, 'FAILED');
  assert.equal(parsed.checkedAt.toISOString(), '2026-09-04T01:02:03.000Z');
  assert.equal(parsed.totalDocumentCount, 6);
  assert.deepEqual(parsed.failureCodes, ['CONCURRENT_CHANGE', 'SETTLEMENT_DRIFT', 'SOURCE_LINK_FAILED']);
  assert.deepEqual(parsed.failureCounts, [
    { code: 'CONCURRENT_CHANGE', count: 2 },
    { code: 'SETTLEMENT_DRIFT', count: 2 },
    { code: 'SOURCE_LINK_FAILED', count: 1 },
  ]);
});

test('legacy reconciliation audit v1 remains readable without inventing historical counts', () => {
  const parsed = parseHospitalityTaxDocumentReconciliationAuditData({
    schemaVersion: 1,
    jurisdictionCode: 'AU',
    status: 'FAILED',
    checkedAt: '2026-09-04T00:00:00.000Z',
    taxInvoiceCount: 1,
    adjustmentNoteCount: 1,
    totalDocumentCount: 2,
    failureCodes: ['SETTLEMENT_DRIFT'],
  });
  assert.ok(parsed);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.failureCounts, null);
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
    schemaVersion: 2,
    jurisdictionCode: 'AU',
    status: 'FAILED',
    checkedAt: '2026-09-04T00:00:00.000Z',
    taxInvoiceCount: 1,
    adjustmentNoteCount: 1,
    totalDocumentCount: 2,
    failureCodes: ['SETTLEMENT_DRIFT'],
    failureCounts: [{ code: 'SOURCE_LINK_FAILED', count: 1 }],
  }), null);
  assert.equal(parseHospitalityTaxDocumentReconciliationAuditData({
    schemaVersion: 2,
    jurisdictionCode: 'AU',
    status: 'FAILED',
    checkedAt: '2026-09-04T00:00:00.000Z',
    taxInvoiceCount: 1,
    adjustmentNoteCount: 0,
    totalDocumentCount: 1,
    failureCodes: ['SETTLEMENT_DRIFT'],
    failureCounts: [{ code: 'SETTLEMENT_DRIFT', count: 0 }],
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
