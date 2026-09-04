import type { Prisma } from '../../generated/prisma/client.ts';
import {
  PublicBookingCapabilityConfigurationError,
  verifyPublicBookingBookingCapability,
} from '../bookings/public-booking-capability.ts';
import { PublicHospitalityBookingUnavailableError } from '../bookings/public-hospitality-search-service.ts';
import { readPublicOrganizationBrandingBySlug } from '../branding/branding-service.ts';
import { db } from '../database.ts';
import {
  HospitalityIssuedAdjustmentNoteDocumentValidationError,
  createHospitalityIssuedCancellationAdjustmentNoteDocument,
} from './hospitality-issued-adjustment-note-document-domain.ts';
import {
  hospitalityIssuedAdjustmentNoteFingerprint,
  parseHospitalityIssuedCancellationAdjustmentNoteSnapshot,
} from './hospitality-issued-adjustment-note-domain.ts';
import {
  HospitalityIssuedInvoiceDocumentValidationError,
  createHospitalityIssuedTaxInvoiceDocument,
} from './hospitality-issued-invoice-document-domain.ts';
import {
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';

const PUBLIC_DOCUMENT_LIMIT = 50;

export class PublicIssuedTaxInvoiceAuthorizationError extends Error {
  constructor(message = 'Tax document access is not available.') {
    super(message);
    this.name = 'PublicIssuedTaxInvoiceAuthorizationError';
  }
}

export class PublicIssuedTaxInvoicePersistenceError extends Error {
  constructor(message = 'Stored tax document evidence failed integrity validation.') {
    super(message);
    this.name = 'PublicIssuedTaxInvoicePersistenceError';
  }
}

function publicBookingSecret() {
  const secret = process.env.SF_PUBLIC_BOOKING_SECRET?.trim();
  if (!secret) throw new PublicBookingCapabilityConfigurationError('SF_PUBLIC_BOOKING_SECRET is required for public booking reads.');
  return secret;
}

type PersistedInvoice = {
  id: string;
  organizationId: string;
  bookingId: string;
  preparationId: string;
  pricingEvidenceId: string;
  issuerProfileId: string;
  jurisdictionCode: string;
  documentType: string;
  documentNumber: string;
  sequenceValue: bigint;
  issuedAt: Date;
  currency: string;
  accommodationSubtotalMinor: bigint;
  taxTotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  totalMinor: bigint;
  preparationFingerprint: string;
  pricingFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  documentFingerprint: string;
  documentSnapshot: Prisma.JsonValue;
};

type PersistedAdjustmentNote = {
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  refundTransactionId: string | null;
  jurisdictionCode: string;
  documentType: string;
  documentNumber: string;
  sequenceValue: bigint;
  issuedAt: Date;
  currency: string;
  adjustmentReason: string;
  decreaseSubtotalMinor: bigint;
  decreaseTaxMinor: bigint;
  decreaseTotalMinor: bigint;
  sourceInvoiceFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  documentFingerprint: string;
  documentSnapshot: Prisma.JsonValue;
};

function validatePersistedInvoice(row: PersistedInvoice) {
  try {
    const snapshot = parseHospitalityIssuedTaxInvoiceSnapshot(row.documentSnapshot);
    if (
      row.jurisdictionCode !== 'AU'
      || row.documentType !== 'TAX_INVOICE'
      || snapshot.organizationId !== row.organizationId
      || snapshot.bookingId !== row.bookingId
      || snapshot.preparationId !== row.preparationId
      || snapshot.pricingEvidenceId !== row.pricingEvidenceId
      || snapshot.issuerProfileId !== row.issuerProfileId
      || snapshot.documentNumber !== row.documentNumber
      || BigInt(snapshot.sequenceValue) !== row.sequenceValue
      || new Date(snapshot.issuedAt).getTime() !== row.issuedAt.getTime()
      || snapshot.currency !== row.currency
      || BigInt(snapshot.accommodationSubtotalMinor) !== row.accommodationSubtotalMinor
      || BigInt(snapshot.taxTotalMinor) !== row.taxTotalMinor
      || BigInt(snapshot.feeTotalMinor) !== row.feeTotalMinor
      || BigInt(snapshot.addonTotalMinor) !== row.addonTotalMinor
      || BigInt(snapshot.totalMinor) !== row.totalMinor
      || snapshot.preparationFingerprint !== row.preparationFingerprint
      || snapshot.pricingFingerprint !== row.pricingFingerprint
      || snapshot.issuerFingerprint !== row.issuerFingerprint
      || snapshot.recipientFingerprint !== row.recipientFingerprint
      || hospitalityIssuedInvoiceFingerprint(snapshot) !== row.documentFingerprint
    ) {
      throw new PublicIssuedTaxInvoicePersistenceError();
    }
    return createHospitalityIssuedTaxInvoiceDocument(snapshot);
  } catch (error) {
    if (error instanceof PublicIssuedTaxInvoicePersistenceError) throw error;
    if (error instanceof HospitalityIssuedInvoiceDocumentValidationError || error instanceof Error) {
      throw new PublicIssuedTaxInvoicePersistenceError(error.message);
    }
    throw new PublicIssuedTaxInvoicePersistenceError();
  }
}

function validatePersistedAdjustmentNote(row: PersistedAdjustmentNote) {
  try {
    const snapshot = parseHospitalityIssuedCancellationAdjustmentNoteSnapshot(row.documentSnapshot);
    if (
      row.jurisdictionCode !== 'AU'
      || row.documentType !== 'ADJUSTMENT_NOTE'
      || row.adjustmentReason !== 'BOOKING_CANCELLATION'
      || row.refundTransactionId === null
      || snapshot.organizationId !== row.organizationId
      || snapshot.bookingId !== row.bookingId
      || snapshot.sourceInvoiceId !== row.sourceInvoiceId
      || snapshot.refundTransactionId !== row.refundTransactionId
      || snapshot.documentNumber !== row.documentNumber
      || BigInt(snapshot.sequenceValue) !== row.sequenceValue
      || new Date(snapshot.issuedAt).getTime() !== row.issuedAt.getTime()
      || snapshot.currency !== row.currency
      || BigInt(snapshot.decreaseSubtotalMinor) !== row.decreaseSubtotalMinor
      || BigInt(snapshot.decreaseTaxMinor) !== row.decreaseTaxMinor
      || BigInt(snapshot.decreaseTotalMinor) !== row.decreaseTotalMinor
      || snapshot.sourceInvoiceFingerprint !== row.sourceInvoiceFingerprint
      || snapshot.issuerFingerprint !== row.issuerFingerprint
      || snapshot.recipientFingerprint !== row.recipientFingerprint
      || hospitalityIssuedAdjustmentNoteFingerprint(snapshot) !== row.documentFingerprint
    ) {
      throw new PublicIssuedTaxInvoicePersistenceError();
    }
    return Object.freeze({ snapshot, document: createHospitalityIssuedCancellationAdjustmentNoteDocument(snapshot) });
  } catch (error) {
    if (error instanceof PublicIssuedTaxInvoicePersistenceError) throw error;
    if (error instanceof HospitalityIssuedAdjustmentNoteDocumentValidationError || error instanceof Error) {
      throw new PublicIssuedTaxInvoicePersistenceError(error.message);
    }
    throw new PublicIssuedTaxInvoicePersistenceError();
  }
}

function customerDocument(document: ReturnType<typeof createHospitalityIssuedTaxInvoiceDocument>) {
  return Object.freeze({
    documentTitle: document.documentTitle,
    documentNumber: document.documentNumber,
    issuedAt: document.issuedAt,
    currency: document.currency,
    seller: Object.freeze({
      legalName: document.seller.legalName,
      addressLine1: document.seller.addressLine1,
      addressLine2: document.seller.addressLine2,
      city: document.seller.city,
      region: document.seller.region,
      postalCode: document.seller.postalCode,
      countryCode: document.seller.countryCode,
      contactEmail: document.seller.contactEmail,
    }),
    buyer: Object.freeze({
      legalName: document.buyer.legalName,
      email: document.buyer.email,
      addressLine1: document.buyer.addressLine1,
      addressLine2: document.buyer.addressLine2,
      city: document.buyer.city,
      region: document.buyer.region,
      postalCode: document.buyer.postalCode,
      countryCode: document.buyer.countryCode,
    }),
    supplierAbn: document.supplierAbn,
    buyerAbn: document.buyerAbn,
    taxableSaleStatement: document.taxableSaleStatement,
    lines: document.lines,
    subtotalBeforeGstMinor: document.subtotalBeforeGstMinor,
    gstMinor: document.gstMinor,
    totalMinor: document.totalMinor,
  });
}

function customerAdjustmentDocument(document: ReturnType<typeof createHospitalityIssuedCancellationAdjustmentNoteDocument>) {
  return Object.freeze({
    documentTitle: document.documentTitle,
    documentNumber: document.documentNumber,
    issuedAt: document.issuedAt,
    currency: document.currency,
    sourceTaxInvoiceNumber: document.sourceTaxInvoiceNumber,
    sourceTaxInvoiceIssuedAt: document.sourceTaxInvoiceIssuedAt,
    seller: Object.freeze({
      legalName: document.seller.legalName,
      addressLine1: document.seller.addressLine1,
      addressLine2: document.seller.addressLine2,
      city: document.seller.city,
      region: document.seller.region,
      postalCode: document.seller.postalCode,
      countryCode: document.seller.countryCode,
      contactEmail: document.seller.contactEmail,
    }),
    buyer: Object.freeze({
      legalName: document.buyer.legalName,
      email: document.buyer.email,
      addressLine1: document.buyer.addressLine1,
      addressLine2: document.buyer.addressLine2,
      city: document.buyer.city,
      region: document.buyer.region,
      postalCode: document.buyer.postalCode,
      countryCode: document.buyer.countryCode,
    }),
    supplierAbn: document.supplierAbn,
    adjustmentType: document.adjustmentType,
    adjustmentReason: document.adjustmentReason,
    priceBeforeAdjustmentMinor: document.priceBeforeAdjustmentMinor,
    priceAfterAdjustmentMinor: document.priceAfterAdjustmentMinor,
    decreaseSubtotalMinor: document.decreaseSubtotalMinor,
    decreaseGstMinor: document.decreaseGstMinor,
    decreaseTotalMinor: document.decreaseTotalMinor,
  });
}

export async function listPublicBookingIssuedTaxInvoices(input: {
  organizationSlug: string;
  bookingCapability: string;
  now?: Date;
}) {
  const branding = await readPublicOrganizationBrandingBySlug(input.organizationSlug);
  if (!branding) throw new PublicHospitalityBookingUnavailableError();

  const now = input.now ?? new Date();
  const capability = verifyPublicBookingBookingCapability({
    secret: publicBookingSecret(),
    token: input.bookingCapability,
    expectedOrganizationId: branding.id,
    now,
  });
  if (!capability) throw new PublicIssuedTaxInvoiceAuthorizationError();

  const invoiceWhere = {
    organizationId: branding.id,
    bookingId: capability.bookingId,
    jurisdictionCode: 'AU',
    documentType: 'TAX_INVOICE',
  } as const;
  const adjustmentWhere = {
    organizationId: branding.id,
    bookingId: capability.bookingId,
    jurisdictionCode: 'AU',
    documentType: 'ADJUSTMENT_NOTE',
    adjustmentReason: 'BOOKING_CANCELLATION',
  } as const;

  const [ownership, principal, booking, total, rows, adjustmentTotal, adjustmentRows] = await Promise.all([
    db.publicBookingBookingOwnership.findUnique({
      where: { organizationId_bookingId: { organizationId: branding.id, bookingId: capability.bookingId } },
      select: { principalId: true },
    }),
    db.publicBookingPrincipal.findFirst({
      where: { id: capability.principalId, organizationId: branding.id, expiresAt: { gt: now } },
      select: { id: true },
    }),
    db.hospitalityBooking.findFirst({
      where: { id: capability.bookingId, organizationId: branding.id },
      select: { id: true },
    }),
    db.hospitalityIssuedInvoice.count({ where: invoiceWhere }),
    db.hospitalityIssuedInvoice.findMany({
      where: invoiceWhere,
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      take: PUBLIC_DOCUMENT_LIMIT,
    }),
    db.hospitalityIssuedAdjustmentNote.count({ where: adjustmentWhere }),
    db.hospitalityIssuedAdjustmentNote.findMany({
      where: adjustmentWhere,
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      take: PUBLIC_DOCUMENT_LIMIT,
    }),
  ]);

  if (!ownership || ownership.principalId !== capability.principalId || !principal || !booking) {
    throw new PublicIssuedTaxInvoiceAuthorizationError();
  }

  const items = rows.map((row) => customerDocument(validatePersistedInvoice(row)));
  const validatedAdjustments = adjustmentRows.map(validatePersistedAdjustmentNote);
  const sourceInvoiceIds = [...new Set(validatedAdjustments.map(({ snapshot }) => snapshot.sourceInvoiceId))];
  const sourceInvoices = sourceInvoiceIds.length
    ? await db.hospitalityIssuedInvoice.findMany({
        where: {
          id: { in: sourceInvoiceIds },
          organizationId: branding.id,
          bookingId: capability.bookingId,
          jurisdictionCode: 'AU',
          documentType: 'TAX_INVOICE',
        },
        select: { id: true, documentNumber: true, issuedAt: true, documentFingerprint: true },
      })
    : [];
  const sourceById = new Map(sourceInvoices.map((entry) => [entry.id, entry]));
  const adjustmentItems = validatedAdjustments.map(({ snapshot, document }) => {
    const source = sourceById.get(snapshot.sourceInvoiceId);
    if (
      !source
      || source.documentNumber !== snapshot.sourceInvoiceDocumentNumber
      || source.issuedAt.getTime() !== new Date(snapshot.sourceInvoiceIssuedAt).getTime()
      || source.documentFingerprint !== snapshot.sourceInvoiceFingerprint
    ) {
      throw new PublicIssuedTaxInvoicePersistenceError('Adjustment-note source tax invoice failed integrity validation.');
    }
    return customerAdjustmentDocument(document);
  });

  return Object.freeze({
    total,
    truncated: total > items.length,
    items: Object.freeze(items),
    adjustmentNotes: Object.freeze({
      total: adjustmentTotal,
      truncated: adjustmentTotal > adjustmentItems.length,
      items: Object.freeze(adjustmentItems),
    }),
  });
}
