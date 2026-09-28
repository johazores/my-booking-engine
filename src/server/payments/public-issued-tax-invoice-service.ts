import type { Prisma } from '../../generated/prisma/client.ts';
import {
  PublicBookingCapabilityConfigurationError,
  verifyPublicBookingBookingCapability,
} from '../bookings/public-booking-capability.ts';
import { PublicHospitalityBookingUnavailableError } from '../bookings/public-hospitality-search-service.ts';
import { readPublicOrganizationBrandingBySlug } from '../branding/branding-service.ts';
import { db } from '../database.ts';
import {
  HospitalityIssuedAdjustmentNoteAuthorityError,
  validateHospitalityIssuedAdjustmentNoteRowsInTransaction,
} from './hospitality-issued-adjustment-note-authority-service.ts';
import {
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
  if (!secret) {
    throw new PublicBookingCapabilityConfigurationError('SF_PUBLIC_BOOKING_SECRET is required for public booking reads.');
  }
  return secret;
}

type PersistedInvoice = Readonly<{
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
}>;

type PublicDocumentAuthority = Readonly<{
  organizationId: string;
  bookingId: string;
  principalId: string;
  now: Date;
}>;

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
    const document = createHospitalityIssuedTaxInvoiceDocument(snapshot);
    if (document.documentFingerprint !== row.documentFingerprint) {
      throw new PublicIssuedTaxInvoicePersistenceError();
    }
    return document;
  } catch (error) {
    if (error instanceof PublicIssuedTaxInvoicePersistenceError) throw error;
    throw new PublicIssuedTaxInvoicePersistenceError(
      error instanceof Error ? error.message : 'Stored tax invoice evidence failed integrity validation.',
    );
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

function customerAdjustmentDocument(
  document: Awaited<ReturnType<typeof validateHospitalityIssuedAdjustmentNoteRowsInTransaction>>[number]['document'],
) {
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
    increaseSubtotalMinor: document.increaseSubtotalMinor,
    increaseGstMinor: document.increaseGstMinor,
    increaseTotalMinor: document.increaseTotalMinor,
  });
}

async function resolvePublicDocumentAuthority(input: {
  organizationSlug: string;
  bookingCapability: string;
  now?: Date;
}): Promise<PublicDocumentAuthority> {
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

  return Object.freeze({
    organizationId: branding.id,
    bookingId: capability.bookingId,
    principalId: capability.principalId,
    now,
  });
}

async function assertPublicDocumentAuthority(
  transaction: Prisma.TransactionClient,
  authority: PublicDocumentAuthority,
) {
  const [ownership, principal] = await Promise.all([
    transaction.publicBookingBookingOwnership.findUnique({
      where: {
        organizationId_bookingId: {
          organizationId: authority.organizationId,
          bookingId: authority.bookingId,
        },
      },
      select: { principalId: true },
    }),
    transaction.publicBookingPrincipal.findFirst({
      where: {
        id: authority.principalId,
        organizationId: authority.organizationId,
        expiresAt: { gt: authority.now },
      },
      select: { id: true },
    }),
  ]);

  if (!ownership || ownership.principalId !== authority.principalId || !principal) {
    throw new PublicIssuedTaxInvoiceAuthorizationError();
  }

  const booking = await transaction.hospitalityBooking.findFirst({
    where: { id: authority.bookingId, organizationId: authority.organizationId },
    select: { id: true },
  });
  if (!booking) throw new PublicIssuedTaxInvoiceAuthorizationError();
}

export async function listPublicBookingIssuedTaxInvoices(input: {
  organizationSlug: string;
  bookingCapability: string;
  now?: Date;
}) {
  const authority = await resolvePublicDocumentAuthority(input);
  const invoiceWhere = {
    organizationId: authority.organizationId,
    bookingId: authority.bookingId,
    jurisdictionCode: 'AU',
    documentType: 'TAX_INVOICE',
  } as const;
  const adjustmentWhere = {
    organizationId: authority.organizationId,
    bookingId: authority.bookingId,
    jurisdictionCode: 'AU',
    documentType: 'ADJUSTMENT_NOTE',
  } as const;

  const snapshot = await db.$transaction(async (transaction) => {
    await assertPublicDocumentAuthority(transaction, authority);

    const [total, rows, adjustmentTotal, adjustmentRows] = await Promise.all([
      transaction.hospitalityIssuedInvoice.count({ where: invoiceWhere }),
      transaction.hospitalityIssuedInvoice.findMany({
        where: invoiceWhere,
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        take: PUBLIC_DOCUMENT_LIMIT,
      }),
      transaction.hospitalityIssuedAdjustmentNote.count({ where: adjustmentWhere }),
      transaction.hospitalityIssuedAdjustmentNote.findMany({
        where: adjustmentWhere,
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        take: PUBLIC_DOCUMENT_LIMIT,
      }),
    ]);
    let validatedAdjustments: Awaited<ReturnType<typeof validateHospitalityIssuedAdjustmentNoteRowsInTransaction>>;
    try {
      validatedAdjustments = await validateHospitalityIssuedAdjustmentNoteRowsInTransaction({
        transaction,
        organizationId: authority.organizationId,
        rows: adjustmentRows,
      });
    } catch (error) {
      if (error instanceof HospitalityIssuedAdjustmentNoteAuthorityError || error instanceof Error) {
        throw new PublicIssuedTaxInvoicePersistenceError(error.message);
      }
      throw new PublicIssuedTaxInvoicePersistenceError();
    }

    return { total, rows, adjustmentTotal, validatedAdjustments };
  }, { isolationLevel: 'RepeatableRead' });

  const items = snapshot.rows.map((row) => customerDocument(validatePersistedInvoice(row)));
  const adjustmentItems = snapshot.validatedAdjustments.map(({ document }) => customerAdjustmentDocument(document));
  return Object.freeze({
    total: snapshot.total,
    truncated: snapshot.total > items.length,
    items: Object.freeze(items),
    adjustmentNotes: Object.freeze({
      total: snapshot.adjustmentTotal,
      truncated: snapshot.adjustmentTotal > adjustmentItems.length,
      items: Object.freeze(adjustmentItems),
    }),
  });
}

export async function getPublicBookingIssuedTaxInvoice(input: {
  organizationSlug: string;
  bookingCapability: string;
  documentNumber: string;
  now?: Date;
}) {
  const authority = await resolvePublicDocumentAuthority(input);

  return db.$transaction(async (transaction) => {
    await assertPublicDocumentAuthority(transaction, authority);
    const row = await transaction.hospitalityIssuedInvoice.findFirst({
      where: {
        organizationId: authority.organizationId,
        bookingId: authority.bookingId,
        jurisdictionCode: 'AU',
        documentType: 'TAX_INVOICE',
        documentNumber: input.documentNumber,
      },
    });
    return row ? customerDocument(validatePersistedInvoice(row)) : null;
  }, { isolationLevel: 'RepeatableRead' });
}

export async function getPublicBookingIssuedAdjustmentNote(input: {
  organizationSlug: string;
  bookingCapability: string;
  documentNumber: string;
  now?: Date;
}) {
  const authority = await resolvePublicDocumentAuthority(input);

  return db.$transaction(async (transaction) => {
    await assertPublicDocumentAuthority(transaction, authority);
    const row = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
      where: {
        organizationId: authority.organizationId,
        bookingId: authority.bookingId,
        jurisdictionCode: 'AU',
        documentType: 'ADJUSTMENT_NOTE',
        documentNumber: input.documentNumber,
      },
    });
    if (!row) return null;

    try {
      const validated = await validateHospitalityIssuedAdjustmentNoteRowsInTransaction({
        transaction,
        organizationId: authority.organizationId,
        rows: [row],
      });
      const item = validated[0];
      if (!item) throw new PublicIssuedTaxInvoicePersistenceError();
      return customerAdjustmentDocument(item.document);
    } catch (error) {
      if (error instanceof HospitalityIssuedAdjustmentNoteAuthorityError || error instanceof Error) {
        throw new PublicIssuedTaxInvoicePersistenceError(error.message);
      }
      throw new PublicIssuedTaxInvoicePersistenceError();
    }
  }, { isolationLevel: 'RepeatableRead' });
}
