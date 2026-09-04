import type { Prisma } from '../../generated/prisma/client.ts';
import {
  PublicBookingCapabilityConfigurationError,
  verifyPublicBookingBookingCapability,
} from '../bookings/public-booking-capability.ts';
import { PublicHospitalityBookingUnavailableError } from '../bookings/public-hospitality-search-service.ts';
import { readPublicOrganizationBrandingBySlug } from '../branding/branding-service.ts';
import { db } from '../database.ts';
import {
  HospitalityIssuedInvoiceDocumentValidationError,
  createHospitalityIssuedTaxInvoiceDocument,
} from './hospitality-issued-invoice-document-domain.ts';
import {
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';

const PUBLIC_INVOICE_LIMIT = 50;

export class PublicIssuedTaxInvoiceAuthorizationError extends Error {
  constructor(message = 'Tax invoice access is not available.') {
    super(message);
    this.name = 'PublicIssuedTaxInvoiceAuthorizationError';
  }
}

export class PublicIssuedTaxInvoicePersistenceError extends Error {
  constructor(message = 'Stored tax invoice evidence failed integrity validation.') {
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

  const where = {
    organizationId: branding.id,
    bookingId: capability.bookingId,
    jurisdictionCode: 'AU',
    documentType: 'TAX_INVOICE',
  } as const;

  const [ownership, principal, booking, total, rows] = await Promise.all([
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
    db.hospitalityIssuedInvoice.count({ where }),
    db.hospitalityIssuedInvoice.findMany({
      where,
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      take: PUBLIC_INVOICE_LIMIT,
    }),
  ]);

  if (!ownership || ownership.principalId !== capability.principalId || !principal || !booking) {
    throw new PublicIssuedTaxInvoiceAuthorizationError();
  }

  const items = rows.map((row) => customerDocument(validatePersistedInvoice(row)));
  return Object.freeze({
    total,
    truncated: total > items.length,
    items: Object.freeze(items),
  });
}
