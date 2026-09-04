import { assessAustralianTaxInvoiceReadiness } from './australian-tax-invoice-domain.ts';
import { parseHospitalityBookingPricingEvidenceBreakdown } from '../bookings/booking-pricing-evidence-domain.ts';
import {
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';
import {
  hospitalityInvoiceRecipientFingerprint,
  parseHospitalityInvoiceRecipientSnapshot,
} from './hospitality-invoice-recipient-domain.ts';
import {
  invoiceIssuerProfileFingerprint,
  parseInvoiceIssuerProfileSnapshot,
} from './invoice-issuer-domain.ts';

export class HospitalityIssuedInvoiceDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityIssuedInvoiceDocumentValidationError';
  }
}

export type HospitalityIssuedTaxInvoiceDocumentLine = Readonly<{
  description: string;
  quantity: number;
  amountMinor: string;
}>;

function minor(value: string, label: string) {
  if (!/^\d+$/.test(value)) {
    throw new HospitalityIssuedInvoiceDocumentValidationError(`${label} is invalid.`);
  }
  return BigInt(value);
}

export function createHospitalityIssuedTaxInvoiceDocument(value: unknown) {
  try {
    const snapshot = parseHospitalityIssuedTaxInvoiceSnapshot(value);
    const issuer = parseInvoiceIssuerProfileSnapshot(snapshot.issuer);
    const recipient = parseHospitalityInvoiceRecipientSnapshot(snapshot.recipient);
    const pricing = parseHospitalityBookingPricingEvidenceBreakdown(snapshot.pricing);

    if (
      invoiceIssuerProfileFingerprint(issuer) !== snapshot.issuerFingerprint
      || hospitalityInvoiceRecipientFingerprint(recipient) !== snapshot.recipientFingerprint
      || pricing.pricingFingerprint !== snapshot.pricingFingerprint
      || pricing.currency !== snapshot.currency
      || pricing.accommodationSubtotalMinor !== snapshot.accommodationSubtotalMinor
      || pricing.taxTotalMinor !== snapshot.taxTotalMinor
      || pricing.feeTotalMinor !== snapshot.feeTotalMinor
      || pricing.addonTotalMinor !== snapshot.addonTotalMinor
      || pricing.totalMinor !== snapshot.totalMinor
    ) {
      throw new HospitalityIssuedInvoiceDocumentValidationError(
        'Issued tax invoice evidence does not match its immutable document snapshot.',
      );
    }

    const assessment = assessAustralianTaxInvoiceReadiness({ issuer, pricing, buyer: recipient });
    if (
      !assessment.contentReady
      || assessment.supplierAbn !== snapshot.australianTax.supplierAbn
      || assessment.buyerIdentityRequired !== snapshot.australianTax.buyerIdentityRequired
      || assessment.buyerIdentity !== snapshot.australianTax.buyerIdentity
      || assessment.buyerAbn !== snapshot.australianTax.buyerAbn
    ) {
      throw new HospitalityIssuedInvoiceDocumentValidationError(
        'Issued tax invoice no longer satisfies its frozen Australian tax-document contract.',
      );
    }

    const lines: HospitalityIssuedTaxInvoiceDocumentLine[] = [];
    for (const night of pricing.nightly) {
      lines.push(Object.freeze({
        description: `Accommodation — ${night.date}`,
        quantity: pricing.quantity,
        amountMinor: (minor(night.amountMinor, 'Nightly amount') * BigInt(pricing.quantity)).toString(),
      }));
    }
    for (const charge of pricing.charges) {
      if (charge.kind !== 'FEE') continue;
      lines.push(Object.freeze({ description: charge.name, quantity: 1, amountMinor: charge.amountMinor }));
    }
    for (const addon of pricing.addons) {
      lines.push(Object.freeze({
        description: addon.name,
        quantity: addon.selectedQuantity,
        amountMinor: addon.amountMinor,
      }));
    }

    const supplySubtotalMinor = lines.reduce((sum, line) => sum + minor(line.amountMinor, 'Supply line amount'), 0n);
    const expectedSupplySubtotalMinor =
      minor(snapshot.accommodationSubtotalMinor, 'Accommodation subtotal')
      + minor(snapshot.feeTotalMinor, 'Fee total')
      + minor(snapshot.addonTotalMinor, 'Add-on total');
    if (supplySubtotalMinor !== expectedSupplySubtotalMinor) {
      throw new HospitalityIssuedInvoiceDocumentValidationError('Issued tax invoice supply lines do not reconcile.');
    }

    return Object.freeze({
      documentTitle: 'Tax invoice' as const,
      documentFingerprint: hospitalityIssuedInvoiceFingerprint(snapshot),
      documentNumber: snapshot.documentNumber,
      issuedAt: snapshot.issuedAt,
      bookingId: snapshot.bookingId,
      currency: snapshot.currency,
      seller: issuer,
      buyer: recipient,
      supplierAbn: snapshot.australianTax.supplierAbn,
      buyerAbn: snapshot.australianTax.buyerAbn,
      taxableSaleStatement: 'All supplies shown on this tax invoice are taxable sales.',
      lines: Object.freeze(lines),
      accommodationSubtotalMinor: snapshot.accommodationSubtotalMinor,
      feeTotalMinor: snapshot.feeTotalMinor,
      addonTotalMinor: snapshot.addonTotalMinor,
      subtotalBeforeGstMinor: supplySubtotalMinor.toString(),
      gstMinor: snapshot.taxTotalMinor,
      totalMinor: snapshot.totalMinor,
    });
  } catch (error) {
    if (error instanceof HospitalityIssuedInvoiceDocumentValidationError) throw error;
    throw new HospitalityIssuedInvoiceDocumentValidationError(
      error instanceof Error ? error.message : 'Issued tax invoice evidence is invalid.',
    );
  }
}
