import { createHash } from 'node:crypto';

import {
  calculateAustralianCancellationDecrease,
  canonicalHospitalityIssuedAdjustmentNoteJson,
  formatAustralianAdjustmentNoteDocumentNumber,
} from './hospitality-issued-adjustment-note-domain.ts';
import { HOSPITALITY_CANCELLATION_AFTER_AMENDMENT_REFUND_LIMIT } from './hospitality-cancellation-after-amendment-adjustment-domain.ts';

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;
const AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN = /^AU-ADJ-[0-9]{8,}$/;

export class HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError';
  }
}

export type HospitalityCancellationAfterAmendmentRefundSnapshot = Readonly<{
  refundTransactionId: string;
  refundOrdinal: string;
  amountMinor: string;
  createdAt: string;
}>;

export type HospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot = Readonly<{
  schemaVersion: 6;
  kind: 'ADJUSTMENT_NOTE';
  jurisdictionCode: 'AU';
  adjustmentType: 'DECREASING';
  adjustmentReason: 'BOOKING_CANCELLATION';
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  sourceInvoiceDocumentNumber: string;
  sourceInvoiceIssuedAt: string;
  sourceAdjustmentOrdinal: string;
  predecessorAdjustmentNoteId: string;
  predecessorAdjustmentDocumentNumber: string;
  predecessorAdjustmentIssuedAt: string;
  predecessorAdjustmentDocumentFingerprint: string;
  predecessorAfterPricingFingerprint: string;
  beforePricingFingerprint: string;
  beforeTaxMinor: string;
  beforeTotalMinor: string;
  afterTaxMinor: '0';
  afterTotalMinor: '0';
  refundAuthorities: readonly HospitalityCancellationAfterAmendmentRefundSnapshot[];
  documentNumber: string;
  sequenceValue: string;
  issuedAt: string;
  currency: 'AUD';
  decreaseSubtotalMinor: string;
  decreaseTaxMinor: string;
  decreaseTotalMinor: string;
  sourceInvoiceFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  issuer: Readonly<Record<string, unknown>>;
  recipient: Readonly<Record<string, unknown>>;
  australianTax: Readonly<{
    documentLabel: 'Adjustment note';
    supplierAbn: string;
    adjustmentReasonLabel: 'Booking cancellation';
    sourceTaxInvoiceNumber: string;
  }>;
}>;

function requiredUuid(value: unknown, label: string) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError(`${label} must be a valid UUID.`);
  }
  return value.trim().toLowerCase();
}

function requiredFingerprint(value: unknown, label: string) {
  if (typeof value !== 'string') throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError(`${label} is invalid.`);
  const normalized = value.trim().toLowerCase();
  if (!FINGERPRINT_PATTERN.test(normalized)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError(`${label} must be a SHA-256 fingerprint.`);
  }
  return normalized;
}

function immutableObject(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function positiveBigint(value: unknown, label: string) {
  if (typeof value !== 'bigint' || value <= 0n) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError(`${label} must be a positive bigint.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function validDate(value: unknown, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError(`${label} must be a valid Date.`);
  }
  return value;
}

function parseBigintString(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError(`${label} is invalid.`);
  }
  return BigInt(value);
}

function parseIntegerString(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError(`${label} is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError(`${label} is too large.`);
  return parsed;
}

export function createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot(input: {
  organizationId: unknown;
  bookingId: unknown;
  sourceInvoiceId: unknown;
  sourceInvoiceDocumentNumber: unknown;
  sourceInvoiceIssuedAt: unknown;
  sourceAdjustmentOrdinal: unknown;
  predecessorAdjustmentNoteId: unknown;
  predecessorAdjustmentDocumentNumber: unknown;
  predecessorAdjustmentIssuedAt: unknown;
  predecessorAdjustmentDocumentFingerprint: unknown;
  predecessorAfterPricingFingerprint: unknown;
  beforePricingFingerprint: unknown;
  beforeTaxMinor: unknown;
  beforeTotalMinor: unknown;
  refundAuthorities: readonly Readonly<{
    refundTransactionId: unknown;
    refundOrdinal: unknown;
    amountMinor: unknown;
    createdAt: unknown;
  }>[];
  documentNumber: unknown;
  sequenceValue: unknown;
  issuedAt: unknown;
  currency: unknown;
  sourceInvoiceFingerprint: unknown;
  issuerFingerprint: unknown;
  recipientFingerprint: unknown;
  issuer: unknown;
  recipient: unknown;
  supplierAbn: unknown;
}): HospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot {
  const sourceAdjustmentOrdinal = positiveInteger(input.sourceAdjustmentOrdinal, 'sourceAdjustmentOrdinal');
  if (sourceAdjustmentOrdinal < 2) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Cancellation-after-amendment sourceAdjustmentOrdinal must be at least 2.');
  }
  const sequenceValue = positiveBigint(input.sequenceValue, 'sequenceValue');
  const expectedDocumentNumber = formatAustralianAdjustmentNoteDocumentNumber(sequenceValue);
  if (typeof input.documentNumber !== 'string' || input.documentNumber !== expectedDocumentNumber || !AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN.test(input.documentNumber)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('documentNumber does not match the allocated Australian adjustment-note sequence.');
  }
  if (typeof input.sourceInvoiceDocumentNumber !== 'string' || !AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN.test(input.sourceInvoiceDocumentNumber)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('sourceInvoiceDocumentNumber must identify an Australian tax invoice.');
  }
  if (typeof input.predecessorAdjustmentDocumentNumber !== 'string' || !AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN.test(input.predecessorAdjustmentDocumentNumber)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('predecessorAdjustmentDocumentNumber must identify an Australian adjustment note.');
  }
  const sourceInvoiceIssuedAt = validDate(input.sourceInvoiceIssuedAt, 'sourceInvoiceIssuedAt');
  const predecessorAdjustmentIssuedAt = validDate(input.predecessorAdjustmentIssuedAt, 'predecessorAdjustmentIssuedAt');
  const issuedAt = validDate(input.issuedAt, 'issuedAt');
  if (predecessorAdjustmentIssuedAt.getTime() < sourceInvoiceIssuedAt.getTime() || issuedAt.getTime() < predecessorAdjustmentIssuedAt.getTime()) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Cancellation-after-amendment chronology is invalid.');
  }
  if (typeof input.currency !== 'string' || input.currency.trim().toUpperCase() !== 'AUD') {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Cancellation-after-amendment supports AUD only.');
  }
  const beforeTotalMinor = positiveBigint(input.beforeTotalMinor, 'beforeTotalMinor');
  const beforeTaxMinor = positiveBigint(input.beforeTaxMinor, 'beforeTaxMinor');
  if (beforeTaxMinor * 11n !== beforeTotalMinor) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Cancellation before-price must reconcile to exact standard GST.');
  }
  const decrease = calculateAustralianCancellationDecrease(beforeTotalMinor);
  if (decrease.decreaseTaxMinor !== beforeTaxMinor) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Cancellation decrease GST does not match the verified legal baseline.');
  }
  const predecessorAfterPricingFingerprint = requiredFingerprint(input.predecessorAfterPricingFingerprint, 'predecessorAfterPricingFingerprint');
  const beforePricingFingerprint = requiredFingerprint(input.beforePricingFingerprint, 'beforePricingFingerprint');
  if (predecessorAfterPricingFingerprint !== beforePricingFingerprint) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Cancellation before-price fingerprint must equal the predecessor after-price fingerprint.');
  }
  if (!Array.isArray(input.refundAuthorities) || input.refundAuthorities.length === 0 || input.refundAuthorities.length > HOSPITALITY_CANCELLATION_AFTER_AMENDMENT_REFUND_LIMIT) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Cancellation refund authority count is invalid.');
  }
  const seenRefundIds = new Set<string>();
  let refundTotalMinor = 0n;
  const refundAuthorities = input.refundAuthorities.map((authority, index): HospitalityCancellationAfterAmendmentRefundSnapshot => {
    const refundTransactionId = requiredUuid(authority.refundTransactionId, 'refundTransactionId');
    if (seenRefundIds.has(refundTransactionId)) {
      throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Cancellation refund authority contains duplicate transaction identity.');
    }
    seenRefundIds.add(refundTransactionId);
    const refundOrdinal = positiveInteger(authority.refundOrdinal, 'refundOrdinal');
    if (refundOrdinal !== index + 1) {
      throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Cancellation refund authority ordinals must be contiguous and ordered.');
    }
    const amountMinor = positiveBigint(authority.amountMinor, 'refund amountMinor');
    const createdAt = validDate(authority.createdAt, 'refund createdAt');
    if (createdAt.getTime() <= predecessorAdjustmentIssuedAt.getTime() || createdAt.getTime() > issuedAt.getTime()) {
      throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Cancellation refund authority chronology is invalid.');
    }
    refundTotalMinor += amountMinor;
    return Object.freeze({
      refundTransactionId,
      refundOrdinal: refundOrdinal.toString(),
      amountMinor: amountMinor.toString(),
      createdAt: createdAt.toISOString(),
    });
  });
  if (refundTotalMinor !== beforeTotalMinor) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Cancellation refund authority must equal the exact verified legal baseline total.');
  }
  if (typeof input.supplierAbn !== 'string' || !/^\d{11}$/.test(input.supplierAbn)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('supplierAbn must be the verified 11-digit Australian Business Number.');
  }

  return Object.freeze({
    schemaVersion: 6,
    kind: 'ADJUSTMENT_NOTE',
    jurisdictionCode: 'AU',
    adjustmentType: 'DECREASING',
    adjustmentReason: 'BOOKING_CANCELLATION',
    organizationId: requiredUuid(input.organizationId, 'organizationId'),
    bookingId: requiredUuid(input.bookingId, 'bookingId'),
    sourceInvoiceId: requiredUuid(input.sourceInvoiceId, 'sourceInvoiceId'),
    sourceInvoiceDocumentNumber: input.sourceInvoiceDocumentNumber,
    sourceInvoiceIssuedAt: sourceInvoiceIssuedAt.toISOString(),
    sourceAdjustmentOrdinal: sourceAdjustmentOrdinal.toString(),
    predecessorAdjustmentNoteId: requiredUuid(input.predecessorAdjustmentNoteId, 'predecessorAdjustmentNoteId'),
    predecessorAdjustmentDocumentNumber: input.predecessorAdjustmentDocumentNumber,
    predecessorAdjustmentIssuedAt: predecessorAdjustmentIssuedAt.toISOString(),
    predecessorAdjustmentDocumentFingerprint: requiredFingerprint(input.predecessorAdjustmentDocumentFingerprint, 'predecessorAdjustmentDocumentFingerprint'),
    predecessorAfterPricingFingerprint,
    beforePricingFingerprint,
    beforeTaxMinor: beforeTaxMinor.toString(),
    beforeTotalMinor: beforeTotalMinor.toString(),
    afterTaxMinor: '0',
    afterTotalMinor: '0',
    refundAuthorities: Object.freeze(refundAuthorities),
    documentNumber: input.documentNumber,
    sequenceValue: sequenceValue.toString(),
    issuedAt: issuedAt.toISOString(),
    currency: 'AUD',
    decreaseSubtotalMinor: decrease.decreaseSubtotalMinor.toString(),
    decreaseTaxMinor: decrease.decreaseTaxMinor.toString(),
    decreaseTotalMinor: decrease.decreaseTotalMinor.toString(),
    sourceInvoiceFingerprint: requiredFingerprint(input.sourceInvoiceFingerprint, 'sourceInvoiceFingerprint'),
    issuerFingerprint: requiredFingerprint(input.issuerFingerprint, 'issuerFingerprint'),
    recipientFingerprint: requiredFingerprint(input.recipientFingerprint, 'recipientFingerprint'),
    issuer: immutableObject(input.issuer, 'issuer'),
    recipient: immutableObject(input.recipient, 'recipient'),
    australianTax: Object.freeze({
      documentLabel: 'Adjustment note',
      supplierAbn: input.supplierAbn,
      adjustmentReasonLabel: 'Booking cancellation',
      sourceTaxInvoiceNumber: input.sourceInvoiceDocumentNumber,
    }),
  });
}

export function parseHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot(value: unknown): HospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Persisted cancellation-after-amendment snapshot must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 6
    || record.kind !== 'ADJUSTMENT_NOTE'
    || record.jurisdictionCode !== 'AU'
    || record.adjustmentType !== 'DECREASING'
    || record.adjustmentReason !== 'BOOKING_CANCELLATION'
  ) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Unsupported cancellation-after-amendment snapshot contract.');
  }
  const australianTax = immutableObject(record.australianTax, 'australianTax');
  if (
    australianTax.documentLabel !== 'Adjustment note'
    || australianTax.adjustmentReasonLabel !== 'Booking cancellation'
    || australianTax.sourceTaxInvoiceNumber !== record.sourceInvoiceDocumentNumber
  ) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('Australian cancellation adjustment-note legal labels are invalid.');
  }
  if (!Array.isArray(record.refundAuthorities)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError('refundAuthorities must be an array.');
  }
  const snapshot = createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot({
    organizationId: record.organizationId,
    bookingId: record.bookingId,
    sourceInvoiceId: record.sourceInvoiceId,
    sourceInvoiceDocumentNumber: record.sourceInvoiceDocumentNumber,
    sourceInvoiceIssuedAt: new Date(typeof record.sourceInvoiceIssuedAt === 'string' ? record.sourceInvoiceIssuedAt : ''),
    sourceAdjustmentOrdinal: parseIntegerString(record.sourceAdjustmentOrdinal, 'sourceAdjustmentOrdinal'),
    predecessorAdjustmentNoteId: record.predecessorAdjustmentNoteId,
    predecessorAdjustmentDocumentNumber: record.predecessorAdjustmentDocumentNumber,
    predecessorAdjustmentIssuedAt: new Date(typeof record.predecessorAdjustmentIssuedAt === 'string' ? record.predecessorAdjustmentIssuedAt : ''),
    predecessorAdjustmentDocumentFingerprint: record.predecessorAdjustmentDocumentFingerprint,
    predecessorAfterPricingFingerprint: record.predecessorAfterPricingFingerprint,
    beforePricingFingerprint: record.beforePricingFingerprint,
    beforeTaxMinor: parseBigintString(record.beforeTaxMinor, 'beforeTaxMinor'),
    beforeTotalMinor: parseBigintString(record.beforeTotalMinor, 'beforeTotalMinor'),
    refundAuthorities: record.refundAuthorities.map((value, index) => {
      const authority = immutableObject(value, `refundAuthorities[${index}]`);
      return {
        refundTransactionId: authority.refundTransactionId,
        refundOrdinal: parseIntegerString(authority.refundOrdinal, `refundAuthorities[${index}].refundOrdinal`),
        amountMinor: parseBigintString(authority.amountMinor, `refundAuthorities[${index}].amountMinor`),
        createdAt: new Date(typeof authority.createdAt === 'string' ? authority.createdAt : ''),
      };
    }),
    documentNumber: record.documentNumber,
    sequenceValue: parseBigintString(record.sequenceValue, 'sequenceValue'),
    issuedAt: new Date(typeof record.issuedAt === 'string' ? record.issuedAt : ''),
    currency: record.currency,
    sourceInvoiceFingerprint: record.sourceInvoiceFingerprint,
    issuerFingerprint: record.issuerFingerprint,
    recipientFingerprint: record.recipientFingerprint,
    issuer: record.issuer,
    recipient: record.recipient,
    supplierAbn: australianTax.supplierAbn,
  });
  if (canonicalHospitalityIssuedAdjustmentNoteJson(record) !== canonicalHospitalityIssuedAdjustmentNoteJson(snapshot)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteValidationError(
      'Persisted cancellation-after-amendment snapshot is not in the canonical immutable shape.',
    );
  }
  return snapshot;
}

export function hospitalityIssuedCancellationAfterAmendmentAdjustmentNoteFingerprint(
  snapshot: HospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot,
) {
  return createHash('sha256').update(canonicalHospitalityIssuedAdjustmentNoteJson(snapshot)).digest('hex');
}
