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

export type HospitalityTaxDocumentReconciliationFailureCode = 'INTEGRITY_CHECK_FAILED' | 'SOURCE_LINK_FAILED' | 'SETTLEMENT_DRIFT' | 'CONCURRENT_CHANGE';

export type HospitalityTaxDocumentReconciliationFailure = Readonly<{
  documentType: 'TAX_INVOICE' | 'ADJUSTMENT_NOTE' | 'REGISTER';
  documentNumber: string | null;
  code: HospitalityTaxDocumentReconciliationFailureCode;
}>;

export type HospitalityTaxDocumentReconciliationFailureCount = Readonly<{
  code: HospitalityTaxDocumentReconciliationFailureCode;
  count: number;
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
  'SETTLEMENT_DRIFT',
  'CONCURRENT_CHANGE',
]);

function canonicalFailureCodes(failures: readonly HospitalityTaxDocumentReconciliationFailure[]) {
  return Object.freeze([...new Set(failures.map((failure) => failure.code))].sort());
}

function canonicalFailureCounts(failures: readonly HospitalityTaxDocumentReconciliationFailure[]) {
  const counts = new Map<HospitalityTaxDocumentReconciliationFailureCode, number>();
  for (const failure of failures) counts.set(failure.code, (counts.get(failure.code) ?? 0) + 1);
  return Object.freeze(
    [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, count]) => Object.freeze({ code, count })),
  );
}

export function createHospitalityTaxDocumentReconciliationAuditData(result: HospitalityTaxDocumentReconciliationResult) {
  return Object.freeze({
    schemaVersion: 2 as const,
    jurisdictionCode: 'AU' as const,
    status: result.status,
    checkedAt: result.checkedAt.toISOString(),
    taxInvoiceCount: result.taxInvoiceCount,
    adjustmentNoteCount: result.adjustmentNoteCount,
    totalDocumentCount: result.totalDocumentCount,
    failureCodes: canonicalFailureCodes(result.failures),
    failureCounts: canonicalFailureCounts(result.failures),
  });
}

function parseFailureCodes(value: unknown) {
  if (!Array.isArray(value)) return null;
  const failureCodes: HospitalityTaxDocumentReconciliationFailureCode[] = [];
  for (const code of value) {
    if (typeof code !== 'string' || !failureCodeSet.has(code as HospitalityTaxDocumentReconciliationFailureCode)) return null;
    failureCodes.push(code as HospitalityTaxDocumentReconciliationFailureCode);
  }
  const canonicalCodes = [...new Set(failureCodes)].sort();
  if (canonicalCodes.length !== failureCodes.length || canonicalCodes.some((code, index) => code !== failureCodes[index])) return null;
  return Object.freeze(failureCodes);
}

function parseFailureCounts(value: unknown, failureCodes: readonly HospitalityTaxDocumentReconciliationFailureCode[]) {
  if (!Array.isArray(value)) return null;
  const failureCounts: HospitalityTaxDocumentReconciliationFailureCount[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (typeof record.code !== 'string' || !failureCodeSet.has(record.code as HospitalityTaxDocumentReconciliationFailureCode)) return null;
    if (!Number.isSafeInteger(record.count) || (record.count as number) <= 0) return null;
    failureCounts.push(Object.freeze({
      code: record.code as HospitalityTaxDocumentReconciliationFailureCode,
      count: record.count as number,
    }));
  }
  const canonicalCounts = [...failureCounts].sort((left, right) => left.code.localeCompare(right.code));
  if (
    canonicalCounts.length !== failureCounts.length
    || canonicalCounts.some((item, index) => item.code !== failureCounts[index]?.code)
    || new Set(failureCounts.map((item) => item.code)).size !== failureCounts.length
    || failureCounts.length !== failureCodes.length
    || failureCounts.some((item, index) => item.code !== failureCodes[index])
  ) return null;
  return Object.freeze(failureCounts);
}

export function parseHospitalityTaxDocumentReconciliationAuditData(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if ((record.schemaVersion !== 1 && record.schemaVersion !== 2) || record.jurisdictionCode !== 'AU') return null;
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

  const failureCodes = parseFailureCodes(record.failureCodes);
  if (!failureCodes) return null;
  if ((record.status === 'VERIFIED') !== (failureCodes.length === 0)) return null;

  if (record.schemaVersion === 1) {
    if ('failureCounts' in record) return null;
    return Object.freeze({
      schemaVersion: 1 as const,
      jurisdictionCode: 'AU' as const,
      status: record.status,
      checkedAt,
      taxInvoiceCount,
      adjustmentNoteCount,
      totalDocumentCount,
      failureCodes,
      failureCounts: null,
    });
  }

  const failureCounts = parseFailureCounts(record.failureCounts, failureCodes);
  if (!failureCounts) return null;
  if ((record.status === 'VERIFIED') !== (failureCounts.length === 0)) return null;
  return Object.freeze({
    schemaVersion: 2 as const,
    jurisdictionCode: 'AU' as const,
    status: record.status,
    checkedAt,
    taxInvoiceCount,
    adjustmentNoteCount,
    totalDocumentCount,
    failureCodes,
    failureCounts,
  });
}
