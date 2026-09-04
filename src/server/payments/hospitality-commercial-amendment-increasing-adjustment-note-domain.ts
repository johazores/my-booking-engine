import { createHash } from 'node:crypto';

import {
  canonicalHospitalityIssuedAdjustmentNoteJson,
  formatAustralianAdjustmentNoteDocumentNumber,
  HospitalityIssuedAdjustmentNoteValidationError,
} from './hospitality-issued-adjustment-note-domain.ts';

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;
const AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN = /^AU-ADJ-[0-9]{8,}$/;

export type HospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot = Readonly<{
  schemaVersion: 4;
  kind: 'ADJUSTMENT_NOTE';
  jurisdictionCode: 'AU';
  adjustmentType: 'INCREASING';
  adjustmentReason: 'COMMERCIAL_AMENDMENT';
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  sourceInvoiceDocumentNumber: string;
  sourceInvoiceIssuedAt: string;
  commercialAmendmentId: string;
  commercialAmendmentAppliedAt: string;
  targetPricingEvidenceId: string;
  sourceAdjustmentOrdinal: '1';
  documentNumber: string;
  sequenceValue: string;
  issuedAt: string;
  currency: 'AUD';
  beforeTaxMinor: string;
  beforeTotalMinor: string;
  afterTaxMinor: string;
  afterTotalMinor: string;
  increaseSubtotalMinor: string;
  increaseTaxMinor: string;
  increaseTotalMinor: string;
  sourceInvoiceFingerprint: string;
  beforePricingFingerprint: string;
  afterPricingFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  issuer: Readonly<Record<string, unknown>>;
  recipient: Readonly<Record<string, unknown>>;
  australianTax: Readonly<{
    documentLabel: 'Adjustment note';
    supplierAbn: string;
    adjustmentReasonLabel: 'Commercial booking amendment';
    sourceTaxInvoiceNumber: string;
  }>;
}>;

function requiredUuid(value: unknown, label: string) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(`${label} must be a valid UUID.`);
  }
  return value.trim().toLowerCase();
}

function requiredFingerprint(value: unknown, label: string) {
  if (typeof value !== 'string') {
    throw new HospitalityIssuedAdjustmentNoteValidationError(`${label} is invalid.`);
  }
  const normalized = value.trim().toLowerCase();
  if (!FINGERPRINT_PATTERN.test(normalized)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(`${label} must be a SHA-256 fingerprint.`);
  }
  return normalized;
}

function immutableObject(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function validDate(value: unknown, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(`${label} must be a valid Date.`);
  }
  return value;
}

function requiredBigint(value: unknown, label: string) {
  if (typeof value !== 'bigint') {
    throw new HospitalityIssuedAdjustmentNoteValidationError(`${label} must be a bigint minor-unit amount.`);
  }
  return value;
}

function recordString(record: Record<string, unknown>, name: string) {
  const value = record[name];
  if (typeof value !== 'string') {
    throw new HospitalityIssuedAdjustmentNoteValidationError(`${name} is invalid.`);
  }
  return value;
}

function recordBigint(record: Record<string, unknown>, name: string) {
  const value = recordString(record, name);
  if (!/^\d+$/.test(value)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(`${name} is invalid.`);
  }
  return BigInt(value);
}

function hasForbiddenAuthorityFields(record: Record<string, unknown>) {
  return (
    'refundTransactionId' in record
    || 'predecessorAdjustmentNoteId' in record
    || 'predecessorAdjustmentDocumentNumber' in record
    || 'predecessorAdjustmentIssuedAt' in record
    || 'predecessorAdjustmentDocumentFingerprint' in record
    || 'predecessorAfterPricingFingerprint' in record
    || 'decreaseSubtotalMinor' in record
    || 'decreaseTaxMinor' in record
    || 'decreaseTotalMinor' in record
  );
}

export function createHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot(input: {
  organizationId: unknown;
  bookingId: unknown;
  sourceInvoiceId: unknown;
  sourceInvoiceDocumentNumber: unknown;
  sourceInvoiceIssuedAt: unknown;
  commercialAmendmentId: unknown;
  commercialAmendmentAppliedAt: unknown;
  targetPricingEvidenceId: unknown;
  sourceAdjustmentOrdinal: unknown;
  documentNumber: unknown;
  sequenceValue: unknown;
  issuedAt: unknown;
  currency: unknown;
  beforeTaxMinor: unknown;
  beforeTotalMinor: unknown;
  afterTaxMinor: unknown;
  afterTotalMinor: unknown;
  sourceInvoiceFingerprint: unknown;
  beforePricingFingerprint: unknown;
  afterPricingFingerprint: unknown;
  issuerFingerprint: unknown;
  recipientFingerprint: unknown;
  issuer: unknown;
  recipient: unknown;
  supplierAbn: unknown;
}): HospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot {
  if (input.sourceAdjustmentOrdinal !== 1) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'The initial increasing commercial-amendment adjustment-note contract supports source ordinal 1 only.',
    );
  }
  if (typeof input.sequenceValue !== 'bigint' || input.sequenceValue <= 0n) {
    throw new HospitalityIssuedAdjustmentNoteValidationError('sequenceValue must be positive.');
  }
  const expectedDocumentNumber = formatAustralianAdjustmentNoteDocumentNumber(input.sequenceValue);
  if (
    typeof input.documentNumber !== 'string'
    || input.documentNumber !== expectedDocumentNumber
    || !AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN.test(input.documentNumber)
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'documentNumber does not match the allocated Australian adjustment-note sequence.',
    );
  }
  if (
    typeof input.sourceInvoiceDocumentNumber !== 'string'
    || !AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN.test(input.sourceInvoiceDocumentNumber)
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'sourceInvoiceDocumentNumber must identify an Australian tax invoice.',
    );
  }

  const sourceInvoiceIssuedAt = validDate(input.sourceInvoiceIssuedAt, 'sourceInvoiceIssuedAt');
  const commercialAmendmentAppliedAt = validDate(
    input.commercialAmendmentAppliedAt,
    'commercialAmendmentAppliedAt',
  );
  const issuedAt = validDate(input.issuedAt, 'issuedAt');
  if (commercialAmendmentAppliedAt.getTime() < sourceInvoiceIssuedAt.getTime()) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Commercial amendment cannot predate its source tax invoice.',
    );
  }
  if (issuedAt.getTime() < commercialAmendmentAppliedAt.getTime()) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Adjustment note cannot predate the applied commercial amendment.',
    );
  }
  if (typeof input.currency !== 'string' || input.currency.trim().toUpperCase() !== 'AUD') {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'The Australian increasing commercial-amendment adjustment-note contract supports AUD only.',
    );
  }

  const beforeTaxMinor = requiredBigint(input.beforeTaxMinor, 'beforeTaxMinor');
  const beforeTotalMinor = requiredBigint(input.beforeTotalMinor, 'beforeTotalMinor');
  const afterTaxMinor = requiredBigint(input.afterTaxMinor, 'afterTaxMinor');
  const afterTotalMinor = requiredBigint(input.afterTotalMinor, 'afterTotalMinor');
  if (
    afterTotalMinor <= beforeTotalMinor
    || beforeTotalMinor <= 0n
    || afterTaxMinor <= beforeTaxMinor
    || beforeTaxMinor < 0n
    || beforeTaxMinor * 11n !== beforeTotalMinor
    || afterTaxMinor * 11n !== afterTotalMinor
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Increasing commercial amendment must preserve fully taxable standard-GST evidence before and after the increase.',
    );
  }

  const increaseTotalMinor = afterTotalMinor - beforeTotalMinor;
  const increaseTaxMinor = afterTaxMinor - beforeTaxMinor;
  const increaseSubtotalMinor = increaseTotalMinor - increaseTaxMinor;
  if (
    increaseSubtotalMinor <= 0n
    || increaseTaxMinor <= 0n
    || increaseTaxMinor * 11n !== increaseTotalMinor
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Commercial-amendment increase does not reconcile to exact standard GST.',
    );
  }
  if (typeof input.supplierAbn !== 'string' || !/^\d{11}$/.test(input.supplierAbn)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'supplierAbn must be the verified 11-digit Australian Business Number.',
    );
  }

  return Object.freeze({
    schemaVersion: 4 as const,
    kind: 'ADJUSTMENT_NOTE' as const,
    jurisdictionCode: 'AU' as const,
    adjustmentType: 'INCREASING' as const,
    adjustmentReason: 'COMMERCIAL_AMENDMENT' as const,
    organizationId: requiredUuid(input.organizationId, 'organizationId'),
    bookingId: requiredUuid(input.bookingId, 'bookingId'),
    sourceInvoiceId: requiredUuid(input.sourceInvoiceId, 'sourceInvoiceId'),
    sourceInvoiceDocumentNumber: input.sourceInvoiceDocumentNumber,
    sourceInvoiceIssuedAt: sourceInvoiceIssuedAt.toISOString(),
    commercialAmendmentId: requiredUuid(input.commercialAmendmentId, 'commercialAmendmentId'),
    commercialAmendmentAppliedAt: commercialAmendmentAppliedAt.toISOString(),
    targetPricingEvidenceId: requiredUuid(input.targetPricingEvidenceId, 'targetPricingEvidenceId'),
    sourceAdjustmentOrdinal: '1' as const,
    documentNumber: input.documentNumber,
    sequenceValue: input.sequenceValue.toString(),
    issuedAt: issuedAt.toISOString(),
    currency: 'AUD' as const,
    beforeTaxMinor: beforeTaxMinor.toString(),
    beforeTotalMinor: beforeTotalMinor.toString(),
    afterTaxMinor: afterTaxMinor.toString(),
    afterTotalMinor: afterTotalMinor.toString(),
    increaseSubtotalMinor: increaseSubtotalMinor.toString(),
    increaseTaxMinor: increaseTaxMinor.toString(),
    increaseTotalMinor: increaseTotalMinor.toString(),
    sourceInvoiceFingerprint: requiredFingerprint(input.sourceInvoiceFingerprint, 'sourceInvoiceFingerprint'),
    beforePricingFingerprint: requiredFingerprint(input.beforePricingFingerprint, 'beforePricingFingerprint'),
    afterPricingFingerprint: requiredFingerprint(input.afterPricingFingerprint, 'afterPricingFingerprint'),
    issuerFingerprint: requiredFingerprint(input.issuerFingerprint, 'issuerFingerprint'),
    recipientFingerprint: requiredFingerprint(input.recipientFingerprint, 'recipientFingerprint'),
    issuer: immutableObject(input.issuer, 'issuer'),
    recipient: immutableObject(input.recipient, 'recipient'),
    australianTax: Object.freeze({
      documentLabel: 'Adjustment note' as const,
      supplierAbn: input.supplierAbn,
      adjustmentReasonLabel: 'Commercial booking amendment' as const,
      sourceTaxInvoiceNumber: input.sourceInvoiceDocumentNumber,
    }),
  });
}

export function parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot(
  value: unknown,
): HospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Persisted increasing commercial-amendment adjustment-note snapshot must be an object.',
    );
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 4
    || record.kind !== 'ADJUSTMENT_NOTE'
    || record.jurisdictionCode !== 'AU'
    || record.adjustmentType !== 'INCREASING'
    || record.adjustmentReason !== 'COMMERCIAL_AMENDMENT'
    || record.sourceAdjustmentOrdinal !== '1'
    || hasForbiddenAuthorityFields(record)
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Unsupported increasing commercial-amendment adjustment-note snapshot contract.',
    );
  }
  const australianTax = immutableObject(record.australianTax, 'australianTax');
  if (
    australianTax.documentLabel !== 'Adjustment note'
    || australianTax.adjustmentReasonLabel !== 'Commercial booking amendment'
    || australianTax.sourceTaxInvoiceNumber !== record.sourceInvoiceDocumentNumber
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Australian increasing commercial-amendment adjustment-note legal labels are invalid.',
    );
  }

  const snapshot = createHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot({
    organizationId: record.organizationId,
    bookingId: record.bookingId,
    sourceInvoiceId: record.sourceInvoiceId,
    sourceInvoiceDocumentNumber: record.sourceInvoiceDocumentNumber,
    sourceInvoiceIssuedAt: new Date(recordString(record, 'sourceInvoiceIssuedAt')),
    commercialAmendmentId: record.commercialAmendmentId,
    commercialAmendmentAppliedAt: new Date(recordString(record, 'commercialAmendmentAppliedAt')),
    targetPricingEvidenceId: record.targetPricingEvidenceId,
    sourceAdjustmentOrdinal: 1,
    documentNumber: record.documentNumber,
    sequenceValue: recordBigint(record, 'sequenceValue'),
    issuedAt: new Date(recordString(record, 'issuedAt')),
    currency: record.currency,
    beforeTaxMinor: recordBigint(record, 'beforeTaxMinor'),
    beforeTotalMinor: recordBigint(record, 'beforeTotalMinor'),
    afterTaxMinor: recordBigint(record, 'afterTaxMinor'),
    afterTotalMinor: recordBigint(record, 'afterTotalMinor'),
    sourceInvoiceFingerprint: record.sourceInvoiceFingerprint,
    beforePricingFingerprint: record.beforePricingFingerprint,
    afterPricingFingerprint: record.afterPricingFingerprint,
    issuerFingerprint: record.issuerFingerprint,
    recipientFingerprint: record.recipientFingerprint,
    issuer: record.issuer,
    recipient: record.recipient,
    supplierAbn: australianTax.supplierAbn,
  });

  if (
    snapshot.increaseSubtotalMinor !== record.increaseSubtotalMinor
    || snapshot.increaseTaxMinor !== record.increaseTaxMinor
    || snapshot.increaseTotalMinor !== record.increaseTotalMinor
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Persisted increasing commercial-amendment adjustment effect does not match its before/after pricing evidence.',
    );
  }
  return snapshot;
}

export function hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint(
  snapshot: HospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot,
) {
  return createHash('sha256')
    .update(canonicalHospitalityIssuedAdjustmentNoteJson(snapshot))
    .digest('hex');
}
