export const HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT = 5_000;
export const HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_AUDIT_ACTION = 'payment.tax-document-reconciliation.completed';
export const HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_RESOURCE_TYPE = 'hospitality-tax-document-register';
export const HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_RESOURCE_ID = 'AU';

export const AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY = Object.freeze({
  jurisdictionCode: 'AU' as const,
  automaticDeletion: false as const,
  mode: 'NO_AUTOMATIC_DELETION' as const,
  minimumRecordYears: 5 as const,
  disposalRequiresLegalReview: true as const,
  rationale: 'SF does not infer disposal authority from document age. A future disposal workflow must confirm the applicable tax record period, assessment/review periods, and privacy obligations before removing or de-identifying legal-document personal information.',
});

export type HospitalityTaxDocumentReconciliationFailureCode = 'INTEGRITY_CHECK_FAILED' | 'SOURCE_LINK_FAILED' | 'CONCURRENT_CHANGE';

export type HospitalityTaxDocumentReconciliationFailure = Readonly<{
  documentType: 'TAX_INVOICE' | 'ADJUSTMENT_NOTE' | 'REGISTER';
  documentNumber: string | null;
  code: HospitalityTaxDocumentReconciliationFailureCode;
}>;

export function createHospitalityTaxDocumentReconciliationResult(input: {
  checkedAt: Date;
  taxInvoiceCount: number;
  adjustmentNoteCount: number;
  failures?: readonly HospitalityTaxDocumentReconciliationFailure[];
}) {
  if (!(input.checkedAt instanceof Date) || Number.isNaN(input.checkedAt.getTime())) {
    throw new TypeError('checkedAt must be a valid Date.');
  }
  for (const [label, value] of [['taxInvoiceCount', input.taxInvoiceCount], ['adjustmentNoteCount', input.adjustmentNoteCount]] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
  const failures = Object.freeze([...(input.failures ?? [])]);
  return Object.freeze({
    status: failures.length === 0 ? 'VERIFIED' as const : 'FAILED' as const,
    checkedAt: new Date(input.checkedAt),
    taxInvoiceCount: input.taxInvoiceCount,
    adjustmentNoteCount: input.adjustmentNoteCount,
    totalDocumentCount: input.taxInvoiceCount + input.adjustmentNoteCount,
    failures,
    retentionPolicy: AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY,
  });
}

export type HospitalityTaxDocumentReconciliationResult = ReturnType<typeof createHospitalityTaxDocumentReconciliationResult>;

const failureCodeSet = new Set<HospitalityTaxDocumentReconciliationFailureCode>([
  'INTEGRITY_CHECK_FAILED',
  'SOURCE_LINK_FAILED',
  'CONCURRENT_CHANGE',
]);

export function createHospitalityTaxDocumentReconciliationAuditData(result: HospitalityTaxDocumentReconciliationResult) {
  const failureCodes = Object.freeze([...new Set(result.failures.map((failure) => failure.code))].sort());
  return Object.freeze({
    schemaVersion: 1 as const,
    jurisdictionCode: 'AU' as const,
    status: result.status,
    checkedAt: result.checkedAt.toISOString(),
    taxInvoiceCount: result.taxInvoiceCount,
    adjustmentNoteCount: result.adjustmentNoteCount,
    totalDocumentCount: result.totalDocumentCount,
    failureCodes,
  });
}

export function parseHospitalityTaxDocumentReconciliationAuditData(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || record.jurisdictionCode !== 'AU') return null;
  if (record.status !== 'VERIFIED' && record.status !== 'FAILED') return null;
  if (typeof record.checkedAt !== 'string') return null;
  const checkedAt = new Date(record.checkedAt);
  if (Number.isNaN(checkedAt.getTime()) || checkedAt.toISOString() !== record.checkedAt) return null;

  const counts = [record.taxInvoiceCount, record.adjustmentNoteCount, record.totalDocumentCount];
  if (counts.some((count) => !Number.isSafeInteger(count) || (count as number) < 0)) return null;
  const taxInvoiceCount = record.taxInvoiceCount as number;
  const adjustmentNoteCount = record.adjustmentNoteCount as number;
  const totalDocumentCount = record.totalDocumentCount as number;
  if (taxInvoiceCount + adjustmentNoteCount !== totalDocumentCount) return null;

  if (!Array.isArray(record.failureCodes)) return null;
  const failureCodes: HospitalityTaxDocumentReconciliationFailureCode[] = [];
  for (const code of record.failureCodes) {
    if (typeof code !== 'string' || !failureCodeSet.has(code as HospitalityTaxDocumentReconciliationFailureCode)) return null;
    failureCodes.push(code as HospitalityTaxDocumentReconciliationFailureCode);
  }
  const canonicalCodes = [...new Set(failureCodes)].sort();
  if (canonicalCodes.length !== failureCodes.length || canonicalCodes.some((code, index) => code !== failureCodes[index])) return null;
  if ((record.status === 'VERIFIED') !== (failureCodes.length === 0)) return null;

  return Object.freeze({
    schemaVersion: 1 as const,
    jurisdictionCode: 'AU' as const,
    status: record.status,
    checkedAt,
    taxInvoiceCount,
    adjustmentNoteCount,
    totalDocumentCount,
    failureCodes: Object.freeze(failureCodes),
  });
}
