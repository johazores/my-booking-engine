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

export function createHospitalityIssuedCancellationAdjustmentNoteDocument(value: unknown) {
  try {
    const snapshot = parseHospitalityIssuedCancellationAdjustmentNoteSnapshot(value);
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
    if (snapshot.australianTax.sourceTaxInvoiceNumber !== snapshot.sourceInvoiceDocumentNumber) {
      throw new HospitalityIssuedAdjustmentNoteDocumentValidationError('Adjustment note source tax-invoice identity is invalid.');
    }
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
    });
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNoteDocumentValidationError) throw error;
    throw new HospitalityIssuedAdjustmentNoteDocumentValidationError(
      error instanceof Error ? error.message : 'Issued adjustment-note evidence is invalid.',
    );
  }
}