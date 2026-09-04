export const HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT = 5_000;

export const AUSTRALIAN_TAX_DOCUMENT_RETENTION_POLICY = Object.freeze({
  jurisdictionCode: 'AU' as const,
  automaticDeletion: false as const,
  mode: 'NO_AUTOMATIC_DELETION' as const,
  minimumRecordYears: 5 as const,
  disposalRequiresLegalReview: true as const,
  rationale: 'SF does not infer disposal authority from document age. A future disposal workflow must confirm the applicable tax record period, assessment/review periods, and privacy obligations before removing or de-identifying legal-document personal information.',
});

export type HospitalityTaxDocumentReconciliationFailure = Readonly<{
  documentType: 'TAX_INVOICE' | 'ADJUSTMENT_NOTE' | 'REGISTER';
  documentNumber: string | null;
  code: 'INTEGRITY_CHECK_FAILED' | 'SOURCE_LINK_FAILED' | 'CONCURRENT_CHANGE';
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
