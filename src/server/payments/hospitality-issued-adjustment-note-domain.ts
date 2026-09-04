import { createHash } from 'node:crypto';

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;
const AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN = /^AU-ADJ-[0-9]{8,}$/;

export class HospitalityIssuedAdjustmentNoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityIssuedAdjustmentNoteValidationError';
  }
}

export type HospitalityIssuedCancellationAdjustmentNoteSnapshot = Readonly<{
  schemaVersion: 1;
  kind: 'ADJUSTMENT_NOTE';
  jurisdictionCode: 'AU';
  adjustmentType: 'DECREASING';
  adjustmentReason: 'BOOKING_CANCELLATION';
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  sourceInvoiceDocumentNumber: string;
  sourceInvoiceIssuedAt: string;
  refundTransactionId: string;
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
    throw new HospitalityIssuedAdjustmentNoteValidationError(`${label} must be a valid UUID.`);
  }
  return value.trim().toLowerCase();
}

function requiredFingerprint(value: unknown, label: string) {
  if (typeof value !== 'string') throw new HospitalityIssuedAdjustmentNoteValidationError(`${label} is invalid.`);
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

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new HospitalityIssuedAdjustmentNoteValidationError('Adjustment-note snapshot cannot contain non-finite numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) throw new HospitalityIssuedAdjustmentNoteValidationError('Adjustment-note snapshot cannot contain undefined values.');
      normalized[key] = canonicalize(entry);
    }
    return normalized;
  }
  throw new HospitalityIssuedAdjustmentNoteValidationError('Adjustment-note snapshot contains an unsupported value.');
}

export function canonicalHospitalityIssuedAdjustmentNoteJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function formatAustralianAdjustmentNoteDocumentNumber(sequenceValue: bigint) {
  if (sequenceValue <= 0n) throw new HospitalityIssuedAdjustmentNoteValidationError('sequenceValue must be positive.');
  return `AU-ADJ-${sequenceValue.toString().padStart(8, '0')}`;
}

export function calculateAustralianCancellationDecrease(totalMinor: bigint) {
  if (totalMinor <= 0n) {
    throw new HospitalityIssuedAdjustmentNoteValidationError('Cancellation decrease must be positive.');
  }
  if (totalMinor % 11n !== 0n) {
    throw new HospitalityIssuedAdjustmentNoteValidationError(
      'The initial cancellation adjustment-note contract requires a GST-inclusive decrease divisible exactly by 11.',
    );
  }
  const decreaseTaxMinor = totalMinor / 11n;
  return Object.freeze({
    decreaseSubtotalMinor: totalMinor - decreaseTaxMinor,
    decreaseTaxMinor,
    decreaseTotalMinor: totalMinor,
  });
}

export function createHospitalityIssuedCancellationAdjustmentNoteSnapshot(input: {
  organizationId: unknown;
  bookingId: unknown;
  sourceInvoiceId: unknown;
  sourceInvoiceDocumentNumber: unknown;
  sourceInvoiceIssuedAt: unknown;
  refundTransactionId: unknown;
  documentNumber: unknown;
  sequenceValue: unknown;
  issuedAt: unknown;
  currency: unknown;
  decreaseTotalMinor: unknown;
  sourceInvoiceFingerprint: unknown;
  issuerFingerprint: unknown;
  recipientFingerprint: unknown;
  issuer: unknown;
  recipient: unknown;
  supplierAbn: unknown;
}): HospitalityIssuedCancellationAdjustmentNoteSnapshot {
  if (typeof input.sequenceValue !== 'bigint' || input.sequenceValue <= 0n) {
    throw new HospitalityIssuedAdjustmentNoteValidationError('sequenceValue must be positive.');
  }
  const expectedDocumentNumber = formatAustralianAdjustmentNoteDocumentNumber(input.sequenceValue);
  if (typeof input.documentNumber !== 'string' || input.documentNumber !== expectedDocumentNumber || !AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN.test(input.documentNumber)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError('documentNumber does not match the allocated Australian adjustment-note sequence.');
  }
  if (typeof input.sourceInvoiceDocumentNumber !== 'string' || !AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN.test(input.sourceInvoiceDocumentNumber)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError('sourceInvoiceDocumentNumber must identify an Australian tax invoice.');
  }
  if (!(input.sourceInvoiceIssuedAt instanceof Date) || Number.isNaN(input.sourceInvoiceIssuedAt.getTime())) {
    throw new HospitalityIssuedAdjustmentNoteValidationError('sourceInvoiceIssuedAt must be a valid Date.');
  }
  if (!(input.issuedAt instanceof Date) || Number.isNaN(input.issuedAt.getTime())) {
    throw new HospitalityIssuedAdjustmentNoteValidationError('issuedAt must be a valid Date.');
  }
  if (input.issuedAt.getTime() < input.sourceInvoiceIssuedAt.getTime()) {
    throw new HospitalityIssuedAdjustmentNoteValidationError('Adjustment note cannot predate its source tax invoice.');
  }
  if (typeof input.currency !== 'string' || input.currency.trim().toUpperCase() !== 'AUD') {
    throw new HospitalityIssuedAdjustmentNoteValidationError('The initial Australian adjustment-note contract supports AUD only.');
  }
  if (typeof input.decreaseTotalMinor !== 'bigint') {
    throw new HospitalityIssuedAdjustmentNoteValidationError('decreaseTotalMinor must be a bigint minor-unit amount.');
  }
  const decrease = calculateAustralianCancellationDecrease(input.decreaseTotalMinor);
  if (typeof input.supplierAbn !== 'string' || !/^\d{11}$/.test(input.supplierAbn)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError('supplierAbn must be the verified 11-digit Australian Business Number.');
  }

  return Object.freeze({
    schemaVersion: 1,
    kind: 'ADJUSTMENT_NOTE',
    jurisdictionCode: 'AU',
    adjustmentType: 'DECREASING',
    adjustmentReason: 'BOOKING_CANCELLATION',
    organizationId: requiredUuid(input.organizationId, 'organizationId'),
    bookingId: requiredUuid(input.bookingId, 'bookingId'),
    sourceInvoiceId: requiredUuid(input.sourceInvoiceId, 'sourceInvoiceId'),
    sourceInvoiceDocumentNumber: input.sourceInvoiceDocumentNumber,
    sourceInvoiceIssuedAt: input.sourceInvoiceIssuedAt.toISOString(),
    refundTransactionId: requiredUuid(input.refundTransactionId, 'refundTransactionId'),
    documentNumber: input.documentNumber,
    sequenceValue: input.sequenceValue.toString(),
    issuedAt: input.issuedAt.toISOString(),
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

function recordString(record: Record<string, unknown>, name: string) {
  const value = record[name];
  if (typeof value !== 'string') throw new HospitalityIssuedAdjustmentNoteValidationError(`${name} is invalid.`);
  return value;
}

function recordBigint(record: Record<string, unknown>, name: string) {
  const value = recordString(record, name);
  if (!/^\d+$/.test(value)) throw new HospitalityIssuedAdjustmentNoteValidationError(`${name} is invalid.`);
  return BigInt(value);
}

export function parseHospitalityIssuedCancellationAdjustmentNoteSnapshot(value: unknown): HospitalityIssuedCancellationAdjustmentNoteSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalityIssuedAdjustmentNoteValidationError('Persisted adjustment-note snapshot must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1
    || record.kind !== 'ADJUSTMENT_NOTE'
    || record.jurisdictionCode !== 'AU'
    || record.adjustmentType !== 'DECREASING'
    || record.adjustmentReason !== 'BOOKING_CANCELLATION'
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError('Unsupported adjustment-note snapshot contract.');
  }
  const australianTax = immutableObject(record.australianTax, 'australianTax');
  if (
    australianTax.documentLabel !== 'Adjustment note'
    || australianTax.adjustmentReasonLabel !== 'Booking cancellation'
    || australianTax.sourceTaxInvoiceNumber !== record.sourceInvoiceDocumentNumber
  ) {
    throw new HospitalityIssuedAdjustmentNoteValidationError('Australian adjustment-note legal labels are invalid.');
  }
  return createHospitalityIssuedCancellationAdjustmentNoteSnapshot({
    organizationId: record.organizationId,
    bookingId: record.bookingId,
    sourceInvoiceId: record.sourceInvoiceId,
    sourceInvoiceDocumentNumber: record.sourceInvoiceDocumentNumber,
    sourceInvoiceIssuedAt: new Date(recordString(record, 'sourceInvoiceIssuedAt')),
    refundTransactionId: record.refundTransactionId,
    documentNumber: record.documentNumber,
    sequenceValue: recordBigint(record, 'sequenceValue'),
    issuedAt: new Date(recordString(record, 'issuedAt')),
    currency: record.currency,
    decreaseTotalMinor: recordBigint(record, 'decreaseTotalMinor'),
    sourceInvoiceFingerprint: record.sourceInvoiceFingerprint,
    issuerFingerprint: record.issuerFingerprint,
    recipientFingerprint: record.recipientFingerprint,
    issuer: record.issuer,
    recipient: record.recipient,
    supplierAbn: australianTax.supplierAbn,
  });
}

export function hospitalityIssuedAdjustmentNoteFingerprint(snapshot: HospitalityIssuedCancellationAdjustmentNoteSnapshot) {
  return createHash('sha256').update(canonicalHospitalityIssuedAdjustmentNoteJson(snapshot)).digest('hex');
}
