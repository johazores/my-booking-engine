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

type HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshotBase = Readonly<{
  kind: 'ADJUSTMENT_NOTE';
  jurisdictionCode: 'AU';
  adjustmentType: 'DECREASING';
  adjustmentReason: 'COMMERCIAL_AMENDMENT';
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  sourceInvoiceDocumentNumber: string;
  sourceInvoiceIssuedAt: string;
  commercialAmendmentId: string;
  commercialAmendmentAppliedAt: string;
  targetPricingEvidenceId: string;
  documentNumber: string;
  sequenceValue: string;
  issuedAt: string;
  currency: 'AUD';
  beforeTaxMinor: string;
  beforeTotalMinor: string;
  afterTaxMinor: string;
  afterTotalMinor: string;
  decreaseSubtotalMinor: string;
  decreaseTaxMinor: string;
  decreaseTotalMinor: string;
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

export type HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshotV2 =
  HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshotBase & Readonly<{
    schemaVersion: 2;
    sourceAdjustmentOrdinal: '1';
  }>;

export type HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshotV3 =
  HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshotBase & Readonly<{
    schemaVersion: 3;
    sourceAdjustmentOrdinal: string;
    predecessorAdjustmentNoteId: string;
    predecessorAdjustmentDocumentNumber: string;
    predecessorAdjustmentIssuedAt: string;
    predecessorAdjustmentDocumentFingerprint: string;
    predecessorAfterPricingFingerprint: string;
  }>;

export type HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot =
  | HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshotV2
  | HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshotV3;

type PredecessorAdjustmentInput = Readonly<{
  adjustmentNoteId: unknown;
  sourceAdjustmentOrdinal: unknown;
  documentNumber: unknown;
  issuedAt: unknown;
  documentFingerprint: unknown;
  afterPricingFingerprint: unknown;
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

function requiredPositiveSafeInteger(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(`${label} must be a positive safe integer.`);
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

function recordPositiveSafeInteger(record: Record<string, unknown>, name: string) {
  const value = recordString(record, name);
  if (!/^[1-9]\d*$/.test(value)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(`${name} is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(`${name} exceeds the supported safe-integer range.`);
  }
  return parsed;
}

function hasPredecessorSnapshotFields(record: Record<string, unknown>) {
  return (
    'predecessorAdjustmentNoteId' in record
    || 'predecessorAdjustmentDocumentNumber' in record
    || 'predecessorAdjustmentIssuedAt' in record
    || 'predecessorAdjustmentDocumentFingerprint' in record
    || 'predecessorAfterPricingFingerprint' in record
  );
}

export function createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot(input: {
  organizationId: unknown;
  bookingId: unknown;
  sourceInvoiceId: unknown;
  sourceInvoiceDocumentNumber: unknown;
  sourceInvoiceIssuedAt: unknown;
  commercialAmendmentId: unknown;
  commercialAmendmentAppliedAt: unknown;
  targetPricingEvidenceId: unknown;
  sourceAdjustmentOrdinal: unknown;
  predecessorAdjustment?: PredecessorAdjustmentInput | null;
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
}): HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot {
  const sourceAdjustmentOrdinal = requiredPositiveSafeInteger(
    input.sourceAdjustmentOrdinal,
    'sourceAdjustmentOrdinal',
  );
  const predecessor = input.predecessorAdjustment ?? null;

  if (sourceAdjustmentOrdinal === 1 && predecessor) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'The first commercial-amendment adjustment note cannot declare a predecessor adjustment note.',
    );
  }
  if (sourceAdjustmentOrdinal !== 1 && !predecessor) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Repeated commercial-amendment adjustment notes require immutable predecessor authority.',
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
  const commercialAmendmentAppliedAt = validDate(input.commercialAmendmentAppliedAt, 'commercialAmendmentAppliedAt');
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
      'The Australian commercial-amendment adjustment-note contract supports AUD only.',
    );
  }

  const beforeTaxMinor = requiredBigint(input.beforeTaxMinor, 'beforeTaxMinor');
  const beforeTotalMinor = requiredBigint(input.beforeTotalMinor, 'beforeTotalMinor');
  const afterTaxMinor = requiredBigint(input.afterTaxMinor, 'afterTaxMinor');
  const afterTotalMinor = requiredBigint(input.afterTotalMinor, 'afterTotalMinor');
  if (
    beforeTotalMinor <= afterTotalMinor
    || afterTotalMinor < 0n
    || beforeTaxMinor <= afterTaxMinor
    || afterTaxMinor < 0n
    || beforeTaxMinor * 11n !== beforeTotalMinor
    || afterTaxMinor * 11n !== afterTotalMinor
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Commercial amendment must preserve fully taxable standard-GST evidence before and after the decrease.',
    );
  }

  const decreaseTotalMinor = beforeTotalMinor - afterTotalMinor;
  const decreaseTaxMinor = beforeTaxMinor - afterTaxMinor;
  const decreaseSubtotalMinor = decreaseTotalMinor - decreaseTaxMinor;
  if (
    decreaseSubtotalMinor <= 0n
    || decreaseTaxMinor <= 0n
    || decreaseTaxMinor * 11n !== decreaseTotalMinor
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Commercial-amendment decrease does not reconcile to exact standard GST.',
    );
  }

  if (typeof input.supplierAbn !== 'string' || !/^\d{11}$/.test(input.supplierAbn)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'supplierAbn must be the verified 11-digit Australian Business Number.',
    );
  }

  const beforePricingFingerprint = requiredFingerprint(
    input.beforePricingFingerprint,
    'beforePricingFingerprint',
  );
  const common = Object.freeze({
    kind: 'ADJUSTMENT_NOTE' as const,
    jurisdictionCode: 'AU' as const,
    adjustmentType: 'DECREASING' as const,
    adjustmentReason: 'COMMERCIAL_AMENDMENT' as const,
    organizationId: requiredUuid(input.organizationId, 'organizationId'),
    bookingId: requiredUuid(input.bookingId, 'bookingId'),
    sourceInvoiceId: requiredUuid(input.sourceInvoiceId, 'sourceInvoiceId'),
    sourceInvoiceDocumentNumber: input.sourceInvoiceDocumentNumber,
    sourceInvoiceIssuedAt: sourceInvoiceIssuedAt.toISOString(),
    commercialAmendmentId: requiredUuid(input.commercialAmendmentId, 'commercialAmendmentId'),
    commercialAmendmentAppliedAt: commercialAmendmentAppliedAt.toISOString(),
    targetPricingEvidenceId: requiredUuid(input.targetPricingEvidenceId, 'targetPricingEvidenceId'),
    documentNumber: input.documentNumber,
    sequenceValue: input.sequenceValue.toString(),
    issuedAt: issuedAt.toISOString(),
    currency: 'AUD' as const,
    beforeTaxMinor: beforeTaxMinor.toString(),
    beforeTotalMinor: beforeTotalMinor.toString(),
    afterTaxMinor: afterTaxMinor.toString(),
    afterTotalMinor: afterTotalMinor.toString(),
    decreaseSubtotalMinor: decreaseSubtotalMinor.toString(),
    decreaseTaxMinor: decreaseTaxMinor.toString(),
    decreaseTotalMinor: decreaseTotalMinor.toString(),
    sourceInvoiceFingerprint: requiredFingerprint(input.sourceInvoiceFingerprint, 'sourceInvoiceFingerprint'),
    beforePricingFingerprint,
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

  if (sourceAdjustmentOrdinal === 1) {
    return Object.freeze({
      schemaVersion: 2 as const,
      ...common,
      sourceAdjustmentOrdinal: '1' as const,
    });
  }
  if (!predecessor) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Repeated commercial-amendment adjustment notes require immutable predecessor authority.',
    );
  }

  const predecessorOrdinal = requiredPositiveSafeInteger(
    predecessor.sourceAdjustmentOrdinal,
    'predecessorAdjustment.sourceAdjustmentOrdinal',
  );
  if (predecessorOrdinal !== sourceAdjustmentOrdinal - 1) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Repeated commercial-amendment adjustment notes must continue the predecessor ordinal exactly.',
    );
  }
  if (
    typeof predecessor.documentNumber !== 'string'
    || !AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN.test(predecessor.documentNumber)
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'predecessorAdjustment.documentNumber must identify an Australian adjustment note.',
    );
  }
  if (predecessor.documentNumber === input.documentNumber) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'A repeated adjustment note cannot identify itself as its predecessor.',
    );
  }

  const predecessorIssuedAt = validDate(
    predecessor.issuedAt,
    'predecessorAdjustment.issuedAt',
  );
  if (predecessorIssuedAt.getTime() < sourceInvoiceIssuedAt.getTime()) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Predecessor adjustment note cannot predate the source tax invoice.',
    );
  }
  if (commercialAmendmentAppliedAt.getTime() < predecessorIssuedAt.getTime()) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Commercial amendment cannot predate its predecessor adjustment note.',
    );
  }

  const predecessorAfterPricingFingerprint = requiredFingerprint(
    predecessor.afterPricingFingerprint,
    'predecessorAdjustment.afterPricingFingerprint',
  );
  if (beforePricingFingerprint !== predecessorAfterPricingFingerprint) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Repeated commercial-amendment before-price fingerprint must equal the predecessor after-price fingerprint.',
    );
  }

  return Object.freeze({
    schemaVersion: 3 as const,
    ...common,
    sourceAdjustmentOrdinal: sourceAdjustmentOrdinal.toString(),
    predecessorAdjustmentNoteId: requiredUuid(
      predecessor.adjustmentNoteId,
      'predecessorAdjustment.adjustmentNoteId',
    ),
    predecessorAdjustmentDocumentNumber: predecessor.documentNumber,
    predecessorAdjustmentIssuedAt: predecessorIssuedAt.toISOString(),
    predecessorAdjustmentDocumentFingerprint: requiredFingerprint(
      predecessor.documentFingerprint,
      'predecessorAdjustment.documentFingerprint',
    ),
    predecessorAfterPricingFingerprint,
  });
}

export function parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot(
  value: unknown,
): HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Persisted commercial-amendment adjustment-note snapshot must be an object.',
    );
  }
  const record = value as Record<string, unknown>;
  if (
    record.kind !== 'ADJUSTMENT_NOTE'
    || record.jurisdictionCode !== 'AU'
    || record.adjustmentType !== 'DECREASING'
    || record.adjustmentReason !== 'COMMERCIAL_AMENDMENT'
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Unsupported commercial-amendment adjustment-note snapshot contract.',
    );
  }
  if ('refundTransactionId' in record) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Commercial-amendment adjustment authority cannot contain refundTransactionId.',
    );
  }

  const australianTax = immutableObject(record.australianTax, 'australianTax');
  if (
    australianTax.documentLabel !== 'Adjustment note'
    || australianTax.adjustmentReasonLabel !== 'Commercial booking amendment'
    || australianTax.sourceTaxInvoiceNumber !== record.sourceInvoiceDocumentNumber
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'Australian commercial-amendment adjustment-note legal labels are invalid.',
    );
  }

  if (record.schemaVersion === 2) {
    if (record.sourceAdjustmentOrdinal !== '1' || hasPredecessorSnapshotFields(record)) {
      throw new HospitalityIssuedAdjustmentNoteValidationError(
        'Schema-version-2 commercial-amendment adjustment-note authority must be the first source adjustment and cannot contain predecessor evidence.',
      );
    }
    return createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
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
  }

  if (record.schemaVersion === 3) {
    const sourceAdjustmentOrdinal = recordPositiveSafeInteger(record, 'sourceAdjustmentOrdinal');
    if (sourceAdjustmentOrdinal < 2 || !hasPredecessorSnapshotFields(record)) {
      throw new HospitalityIssuedAdjustmentNoteValidationError(
        'Schema-version-3 commercial-amendment adjustment-note authority requires a repeated source ordinal and predecessor evidence.',
      );
    }
    return createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
      organizationId: record.organizationId,
      bookingId: record.bookingId,
      sourceInvoiceId: record.sourceInvoiceId,
      sourceInvoiceDocumentNumber: record.sourceInvoiceDocumentNumber,
      sourceInvoiceIssuedAt: new Date(recordString(record, 'sourceInvoiceIssuedAt')),
      commercialAmendmentId: record.commercialAmendmentId,
      commercialAmendmentAppliedAt: new Date(recordString(record, 'commercialAmendmentAppliedAt')),
      targetPricingEvidenceId: record.targetPricingEvidenceId,
      sourceAdjustmentOrdinal,
      predecessorAdjustment: {
        adjustmentNoteId: record.predecessorAdjustmentNoteId,
        sourceAdjustmentOrdinal: sourceAdjustmentOrdinal - 1,
        documentNumber: record.predecessorAdjustmentDocumentNumber,
        issuedAt: new Date(recordString(record, 'predecessorAdjustmentIssuedAt')),
        documentFingerprint: record.predecessorAdjustmentDocumentFingerprint,
        afterPricingFingerprint: record.predecessorAfterPricingFingerprint,
      },
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
  }

  throw new HospitalityIssuedAdjustmentNoteValidationError(
    'Unsupported commercial-amendment adjustment-note snapshot contract.',
  );
}

export function hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(
  snapshot: HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot,
) {
  return createHash('sha256')
    .update(canonicalHospitalityIssuedAdjustmentNoteJson(snapshot))
    .digest('hex');
}
