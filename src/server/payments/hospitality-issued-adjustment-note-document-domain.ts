import {
  hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-adjustment-note-domain.ts';
import {
  hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-increasing-adjustment-note-domain.ts';
import {
  hospitalityIssuedAdjustmentNoteFingerprint,
  parseHospitalityIssuedCancellationAdjustmentNoteSnapshot,
} from './hospitality-issued-adjustment-note-domain.ts';
import {
  hospitalityInvoiceRecipientFingerprint,
  parseHospitalityInvoiceRecipientSnapshot,
} from './hospitality-invoice-recipient-domain.ts';
import {
  invoiceIssuerProfileFingerprint,
  parseInvoiceIssuerProfileSnapshot,
} from './invoice-issuer-domain.ts';

export class HospitalityIssuedAdjustmentNoteDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityIssuedAdjustmentNoteDocumentValidationError';
  }
}

function validateParties(snapshot: {
  issuer: unknown;
  recipient: unknown;
  issuerFingerprint: string;
  recipientFingerprint: string;
}) {
  const issuer = parseInvoiceIssuerProfileSnapshot(snapshot.issuer);
  const recipient = parseHospitalityInvoiceRecipientSnapshot(snapshot.recipient);
  if (
    invoiceIssuerProfileFingerprint(issuer) !== snapshot.issuerFingerprint
    || hospitalityInvoiceRecipientFingerprint(recipient) !== snapshot.recipientFingerprint
  ) {
    throw new HospitalityIssuedAdjustmentNoteDocumentValidationError(
      'Adjustment-note party evidence does not match its immutable document snapshot.',
    );
  }
  return { issuer, recipient };
}

function validateSourceIdentity(snapshot: {
  australianTax: Readonly<Record<string, unknown>>;
  sourceInvoiceDocumentNumber: string;
}) {
  if (snapshot.australianTax.sourceTaxInvoiceNumber !== snapshot.sourceInvoiceDocumentNumber) {
    throw new HospitalityIssuedAdjustmentNoteDocumentValidationError(
      'Adjustment note source tax-invoice identity is invalid.',
    );
  }
}

function cancellationDocument(value: unknown) {
  const snapshot = parseHospitalityIssuedCancellationAdjustmentNoteSnapshot(value);
  const { issuer, recipient } = validateParties(snapshot);
  validateSourceIdentity(snapshot);
  return Object.freeze({
    documentTitle: 'Adjustment note' as const,
    documentFingerprint: hospitalityIssuedAdjustmentNoteFingerprint(snapshot),
    documentNumber: snapshot.documentNumber,
    issuedAt: snapshot.issuedAt,
    bookingId: snapshot.bookingId,
    sourceTaxInvoiceNumber: snapshot.sourceInvoiceDocumentNumber,
    sourceTaxInvoiceIssuedAt: snapshot.sourceInvoiceIssuedAt,
    currency: snapshot.currency,
    seller: issuer,
    buyer: recipient,
    supplierAbn: snapshot.australianTax.supplierAbn,
    adjustmentType: 'Decreasing adjustment' as const,
    adjustmentReason: snapshot.australianTax.adjustmentReasonLabel,
    priceBeforeAdjustmentMinor: snapshot.decreaseTotalMinor,
    priceAfterAdjustmentMinor: '0',
    decreaseSubtotalMinor: snapshot.decreaseSubtotalMinor,
    decreaseGstMinor: snapshot.decreaseTaxMinor,
    decreaseTotalMinor: snapshot.decreaseTotalMinor,
    increaseSubtotalMinor: '0',
    increaseGstMinor: '0',
    increaseTotalMinor: '0',
  });
}

function decreasingCommercialAmendmentDocument(value: unknown) {
  const snapshot = parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot(value);
  const { issuer, recipient } = validateParties(snapshot);
  validateSourceIdentity(snapshot);
  return Object.freeze({
    documentTitle: 'Adjustment note' as const,
    documentFingerprint: hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(snapshot),
    documentNumber: snapshot.documentNumber,
    issuedAt: snapshot.issuedAt,
    bookingId: snapshot.bookingId,
    sourceTaxInvoiceNumber: snapshot.sourceInvoiceDocumentNumber,
    sourceTaxInvoiceIssuedAt: snapshot.sourceInvoiceIssuedAt,
    currency: snapshot.currency,
    seller: issuer,
    buyer: recipient,
    supplierAbn: snapshot.australianTax.supplierAbn,
    adjustmentType: 'Decreasing adjustment' as const,
    adjustmentReason: snapshot.australianTax.adjustmentReasonLabel,
    priceBeforeAdjustmentMinor: snapshot.beforeTotalMinor,
    priceAfterAdjustmentMinor: snapshot.afterTotalMinor,
    decreaseSubtotalMinor: snapshot.decreaseSubtotalMinor,
    decreaseGstMinor: snapshot.decreaseTaxMinor,
    decreaseTotalMinor: snapshot.decreaseTotalMinor,
    increaseSubtotalMinor: '0',
    increaseGstMinor: '0',
    increaseTotalMinor: '0',
  });
}

function increasingCommercialAmendmentDocument(value: unknown) {
  const snapshot = parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot(value);
  const { issuer, recipient } = validateParties(snapshot);
  validateSourceIdentity(snapshot);
  return Object.freeze({
    documentTitle: 'Adjustment note' as const,
    documentFingerprint: hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint(snapshot),
    documentNumber: snapshot.documentNumber,
    issuedAt: snapshot.issuedAt,
    bookingId: snapshot.bookingId,
    sourceTaxInvoiceNumber: snapshot.sourceInvoiceDocumentNumber,
    sourceTaxInvoiceIssuedAt: snapshot.sourceInvoiceIssuedAt,
    currency: snapshot.currency,
    seller: issuer,
    buyer: recipient,
    supplierAbn: snapshot.australianTax.supplierAbn,
    adjustmentType: 'Increasing adjustment' as const,
    adjustmentReason: snapshot.australianTax.adjustmentReasonLabel,
    priceBeforeAdjustmentMinor: snapshot.beforeTotalMinor,
    priceAfterAdjustmentMinor: snapshot.afterTotalMinor,
    decreaseSubtotalMinor: '0',
    decreaseGstMinor: '0',
    decreaseTotalMinor: '0',
    increaseSubtotalMinor: snapshot.increaseSubtotalMinor,
    increaseGstMinor: snapshot.increaseTaxMinor,
    increaseTotalMinor: snapshot.increaseTotalMinor,
  });
}

export function createHospitalityIssuedAdjustmentNoteDocument(value: unknown) {
  try {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (record.adjustmentReason === 'COMMERCIAL_AMENDMENT' && record.adjustmentType === 'INCREASING') {
        return increasingCommercialAmendmentDocument(value);
      }
      if (record.adjustmentReason === 'COMMERCIAL_AMENDMENT' && record.adjustmentType === 'DECREASING') {
        return decreasingCommercialAmendmentDocument(value);
      }
      if (record.adjustmentReason === 'BOOKING_CANCELLATION') return cancellationDocument(value);
    }
    throw new HospitalityIssuedAdjustmentNoteDocumentValidationError(
      'Unsupported issued adjustment-note evidence.',
    );
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNoteDocumentValidationError) throw error;
    throw new HospitalityIssuedAdjustmentNoteDocumentValidationError(
      error instanceof Error ? error.message : 'Issued adjustment-note evidence is invalid.',
    );
  }
}

export function createHospitalityIssuedCancellationAdjustmentNoteDocument(value: unknown) {
  const document = createHospitalityIssuedAdjustmentNoteDocument(value);
  if (document.adjustmentReason !== 'Booking cancellation') {
    throw new HospitalityIssuedAdjustmentNoteDocumentValidationError(
      'Issued adjustment note is not a booking-cancellation document.',
    );
  }
  return document;
}
