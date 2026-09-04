import type { Prisma } from '../../generated/prisma/client.ts';
import {
  PublicBookingCapabilityConfigurationError,
  verifyPublicBookingBookingCapability,
} from '../bookings/public-booking-capability.ts';
import {
  parseHospitalityBookingPricingEvidenceBreakdown,
} from '../bookings/booking-pricing-evidence-domain.ts';
import { PublicHospitalityBookingUnavailableError } from '../bookings/public-hospitality-search-service.ts';
import { readPublicOrganizationBrandingBySlug } from '../branding/branding-service.ts';
import { db } from '../database.ts';
import {
  hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-adjustment-note-domain.ts';
import {
  HospitalityIssuedAdjustmentNoteDocumentValidationError,
  createHospitalityIssuedAdjustmentNoteDocument,
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
  commercialAmendmentId: string | null;
  targetPricingEvidenceId: string | null;
  sourceAdjustmentOrdinal: number;
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

type ValidatedCancellation = Readonly<{
  kind: 'BOOKING_CANCELLATION';
  row: PersistedAdjustmentNote;
  snapshot: ReturnType<typeof parseHospitalityIssuedCancellationAdjustmentNoteSnapshot>;
  document: ReturnType<typeof createHospitalityIssuedAdjustmentNoteDocument>;
}>;

type ValidatedCommercialAmendment = Readonly<{
  kind: 'COMMERCIAL_AMENDMENT';
  row: PersistedAdjustmentNote;
  snapshot: ReturnType<typeof parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot>;
  document: ReturnType<typeof createHospitalityIssuedAdjustmentNoteDocument>;
}>;

type ValidatedAdjustmentNote = ValidatedCancellation | ValidatedCommercialAmendment;

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
    if (error instanceof HospitalityIssuedInvoiceDocumentValidationError || error instanceof Error) {
      throw new PublicIssuedTaxInvoicePersistenceError(error.message);
    }
    throw new PublicIssuedTaxInvoicePersistenceError();
  }
}

function validateCancellationAdjustmentNote(row: PersistedAdjustmentNote): ValidatedCancellation {
  const snapshot = parseHospitalityIssuedCancellationAdjustmentNoteSnapshot(row.documentSnapshot);
  if (
    row.jurisdictionCode !== 'AU'
    || row.documentType !== 'ADJUSTMENT_NOTE'
    || row.adjustmentReason !== 'BOOKING_CANCELLATION'
    || row.refundTransactionId === null
    || row.commercialAmendmentId !== null
    || row.targetPricingEvidenceId !== null
    || row.sourceAdjustmentOrdinal !== 1
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
    throw new PublicIssuedTaxInvoicePersistenceError('Persisted cancellation adjustment note failed integrity validation.');
  }
  const document = createHospitalityIssuedAdjustmentNoteDocument(snapshot);
  if (document.documentFingerprint !== row.documentFingerprint || document.adjustmentReason !== 'Booking cancellation') {
    throw new PublicIssuedTaxInvoicePersistenceError('Cancellation adjustment-note document projection failed integrity validation.');
  }
  return Object.freeze({ kind: 'BOOKING_CANCELLATION', row, snapshot, document });
}

function validateCommercialAdjustmentNote(row: PersistedAdjustmentNote): ValidatedCommercialAmendment {
  const snapshot = parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot(row.documentSnapshot);
  if (
    row.jurisdictionCode !== 'AU'
    || row.documentType !== 'ADJUSTMENT_NOTE'
    || row.adjustmentReason !== 'COMMERCIAL_AMENDMENT'
    || row.refundTransactionId !== null
    || row.commercialAmendmentId === null
    || row.targetPricingEvidenceId === null
    || row.sourceAdjustmentOrdinal !== 1
    || snapshot.organizationId !== row.organizationId
    || snapshot.bookingId !== row.bookingId
    || snapshot.sourceInvoiceId !== row.sourceInvoiceId
    || snapshot.commercialAmendmentId !== row.commercialAmendmentId
    || snapshot.targetPricingEvidenceId !== row.targetPricingEvidenceId
    || snapshot.sourceAdjustmentOrdinal !== '1'
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
    || hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(snapshot) !== row.documentFingerprint
  ) {
    throw new PublicIssuedTaxInvoicePersistenceError('Persisted commercial-amendment adjustment note failed integrity validation.');
  }
  const document = createHospitalityIssuedAdjustmentNoteDocument(snapshot);
  if (document.documentFingerprint !== row.documentFingerprint || document.adjustmentReason !== 'Commercial booking amendment') {
    throw new PublicIssuedTaxInvoicePersistenceError('Commercial-amendment adjustment-note document projection failed integrity validation.');
  }
  return Object.freeze({ kind: 'COMMERCIAL_AMENDMENT', row, snapshot, document });
}

function validatePersistedAdjustmentNote(row: PersistedAdjustmentNote): ValidatedAdjustmentNote {
  try {
    if (row.adjustmentReason === 'BOOKING_CANCELLATION') return validateCancellationAdjustmentNote(row);
    if (row.adjustmentReason === 'COMMERCIAL_AMENDMENT') return validateCommercialAdjustmentNote(row);
    throw new PublicIssuedTaxInvoicePersistenceError('Unsupported persisted adjustment-note reason.');
  } catch (error) {
    if (error instanceof PublicIssuedTaxInvoicePersistenceError) throw error;
    if (error instanceof HospitalityIssuedAdjustmentNoteDocumentValidationError || error instanceof Error) {
      throw new PublicIssuedTaxInvoicePersistenceError(error.message);
    }
    throw new PublicIssuedTaxInvoicePersistenceError();
  }
}

function validateAdjustmentSourceInvoice(item: ValidatedAdjustmentNote, sourceInvoice: PersistedInvoice | undefined) {
  if (!sourceInvoice) {
    throw new PublicIssuedTaxInvoicePersistenceError('Adjustment-note source tax invoice failed integrity validation.');
  }
  validatePersistedInvoice(sourceInvoice);
  if (
    sourceInvoice.organizationId !== item.row.organizationId
    || sourceInvoice.bookingId !== item.row.bookingId
    || sourceInvoice.documentNumber !== item.snapshot.sourceInvoiceDocumentNumber
    || sourceInvoice.issuedAt.getTime() !== new Date(item.snapshot.sourceInvoiceIssuedAt).getTime()
    || sourceInvoice.documentFingerprint !== item.snapshot.sourceInvoiceFingerprint
    || sourceInvoice.documentFingerprint !== item.row.sourceInvoiceFingerprint
    || sourceInvoice.issuerFingerprint !== item.row.issuerFingerprint
    || sourceInvoice.recipientFingerprint !== item.row.recipientFingerprint
  ) {
    throw new PublicIssuedTaxInvoicePersistenceError('Adjustment-note source tax invoice failed integrity validation.');
  }
}

function validateCancellationAuthority(
  item: ValidatedCancellation,
  refund: {
    id: string;
    bookingId: string;
    commercialAmendmentId: string | null;
    kind: string;
    status: string;
    currency: string;
    amountMinor: bigint;
    sourceProviderReference: string | null;
    createdAt: Date;
  } | undefined,
) {
  if (
    !refund
    || refund.id !== item.snapshot.refundTransactionId
    || refund.bookingId !== item.row.bookingId
    || refund.commercialAmendmentId !== null
    || refund.kind !== 'REFUND'
    || refund.status !== 'SUCCEEDED'
    || refund.currency !== item.document.currency
    || refund.amountMinor !== BigInt(item.document.decreaseTotalMinor)
    || refund.sourceProviderReference === null
    || refund.createdAt.getTime() < new Date(item.snapshot.sourceInvoiceIssuedAt).getTime()
    || refund.createdAt.getTime() > item.row.issuedAt.getTime()
  ) {
    throw new PublicIssuedTaxInvoicePersistenceError('Cancellation adjustment-note refund authority failed integrity validation.');
  }
}

function validateCommercialAuthority(
  item: ValidatedCommercialAmendment,
  sourceInvoice: PersistedInvoice,
  amendment: {
    id: string;
    bookingId: string;
    status: string;
    direction: string;
    appliedAt: Date | null;
    currency: string;
    beforeAccommodationSubtotalMinor: bigint;
    beforeTaxTotalMinor: bigint;
    beforeFeeTotalMinor: bigint;
    beforeAddonTotalMinor: bigint;
    beforeTotalMinor: bigint;
    afterAccommodationSubtotalMinor: bigint;
    afterTaxTotalMinor: bigint;
    afterFeeTotalMinor: bigint;
    afterAddonTotalMinor: bigint;
    afterTotalMinor: bigint;
    beforePricingFingerprint: string;
    afterPricingFingerprint: string;
  } | undefined,
  targetEvidence: {
    id: string;
    bookingId: string;
    commercialAmendmentId: string | null;
    source: string;
    currency: string;
    accommodationSubtotalMinor: bigint;
    taxTotalMinor: bigint;
    feeTotalMinor: bigint;
    addonTotalMinor: bigint;
    totalMinor: bigint;
    pricingFingerprint: string;
    pricingBreakdown: Prisma.JsonValue;
  } | undefined,
) {
  if (
    !amendment
    || amendment.id !== item.snapshot.commercialAmendmentId
    || amendment.bookingId !== item.row.bookingId
    || amendment.status !== 'APPLIED'
    || amendment.direction !== 'REFUND'
    || !amendment.appliedAt
    || amendment.appliedAt.getTime() !== new Date(item.snapshot.commercialAmendmentAppliedAt).getTime()
    || amendment.currency !== item.document.currency
    || sourceInvoice.currency !== amendment.currency
    || sourceInvoice.accommodationSubtotalMinor !== amendment.beforeAccommodationSubtotalMinor
    || sourceInvoice.taxTotalMinor !== amendment.beforeTaxTotalMinor
    || sourceInvoice.feeTotalMinor !== amendment.beforeFeeTotalMinor
    || sourceInvoice.addonTotalMinor !== amendment.beforeAddonTotalMinor
    || sourceInvoice.totalMinor !== amendment.beforeTotalMinor
    || sourceInvoice.pricingFingerprint !== amendment.beforePricingFingerprint
    || amendment.beforeTaxTotalMinor !== BigInt(item.snapshot.beforeTaxMinor)
    || amendment.beforeTotalMinor !== BigInt(item.snapshot.beforeTotalMinor)
    || amendment.afterTaxTotalMinor !== BigInt(item.snapshot.afterTaxMinor)
    || amendment.afterTotalMinor !== BigInt(item.snapshot.afterTotalMinor)
    || amendment.beforePricingFingerprint !== item.snapshot.beforePricingFingerprint
    || amendment.afterPricingFingerprint !== item.snapshot.afterPricingFingerprint
  ) {
    throw new PublicIssuedTaxInvoicePersistenceError('Commercial-amendment adjustment-note authority failed integrity validation.');
  }

  if (
    !targetEvidence
    || targetEvidence.id !== item.snapshot.targetPricingEvidenceId
    || targetEvidence.bookingId !== item.row.bookingId
    || targetEvidence.commercialAmendmentId !== item.snapshot.commercialAmendmentId
    || targetEvidence.source !== 'COMMERCIAL_AMENDMENT_TARGET'
    || targetEvidence.currency !== item.document.currency
    || targetEvidence.accommodationSubtotalMinor !== amendment.afterAccommodationSubtotalMinor
    || targetEvidence.taxTotalMinor !== amendment.afterTaxTotalMinor
    || targetEvidence.feeTotalMinor !== amendment.afterFeeTotalMinor
    || targetEvidence.addonTotalMinor !== amendment.afterAddonTotalMinor
    || targetEvidence.totalMinor !== amendment.afterTotalMinor
    || targetEvidence.taxTotalMinor !== BigInt(item.snapshot.afterTaxMinor)
    || targetEvidence.totalMinor !== BigInt(item.snapshot.afterTotalMinor)
    || targetEvidence.pricingFingerprint !== item.snapshot.afterPricingFingerprint
  ) {
    throw new PublicIssuedTaxInvoicePersistenceError('Commercial-amendment target pricing authority failed integrity validation.');
  }

  try {
    const breakdown = parseHospitalityBookingPricingEvidenceBreakdown(targetEvidence.pricingBreakdown);
    if (
      breakdown.currency !== targetEvidence.currency
      || BigInt(breakdown.accommodationSubtotalMinor) !== targetEvidence.accommodationSubtotalMinor
      || BigInt(breakdown.taxTotalMinor) !== targetEvidence.taxTotalMinor
      || BigInt(breakdown.feeTotalMinor) !== targetEvidence.feeTotalMinor
      || BigInt(breakdown.addonTotalMinor) !== targetEvidence.addonTotalMinor
      || BigInt(breakdown.totalMinor) !== targetEvidence.totalMinor
      || breakdown.pricingFingerprint !== targetEvidence.pricingFingerprint
    ) {
      throw new PublicIssuedTaxInvoicePersistenceError('Commercial-amendment target pricing breakdown failed immutable validation.');
    }
  } catch (error) {
    if (error instanceof PublicIssuedTaxInvoicePersistenceError) throw error;
    throw new PublicIssuedTaxInvoicePersistenceError(
      error instanceof Error ? error.message : 'Commercial-amendment target pricing breakdown is invalid.',
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

function customerAdjustmentDocument(document: ReturnType<typeof createHospitalityIssuedAdjustmentNoteDocument>) {
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

  const [ownership, principal, booking] = await Promise.all([
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
  ]);

  if (!ownership || ownership.principalId !== capability.principalId || !principal || !booking) {
    throw new PublicIssuedTaxInvoiceAuthorizationError();
  }

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
  } as const;

  const [total, rows, adjustmentTotal, adjustmentRows] = await Promise.all([
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

  const items = rows.map((row) => customerDocument(validatePersistedInvoice(row)));
  const validatedAdjustments = adjustmentRows.map(validatePersistedAdjustmentNote);
  const sourceInvoiceIds = [...new Set(validatedAdjustments.map(({ snapshot }) => snapshot.sourceInvoiceId))];
  const cancellationItems = validatedAdjustments.filter(
    (item): item is ValidatedCancellation => item.kind === 'BOOKING_CANCELLATION',
  );
  const commercialItems = validatedAdjustments.filter(
    (item): item is ValidatedCommercialAmendment => item.kind === 'COMMERCIAL_AMENDMENT',
  );
  const refundIds = [...new Set(cancellationItems.map((item) => item.snapshot.refundTransactionId))];
  const amendmentIds = [...new Set(commercialItems.map((item) => item.snapshot.commercialAmendmentId))];
  const targetEvidenceIds = [...new Set(commercialItems.map((item) => item.snapshot.targetPricingEvidenceId))];

  const [sourceInvoices, refunds, amendments, targetEvidenceRows] = await Promise.all([
    sourceInvoiceIds.length
      ? db.hospitalityIssuedInvoice.findMany({
          where: {
            id: { in: sourceInvoiceIds },
            organizationId: branding.id,
            bookingId: capability.bookingId,
            jurisdictionCode: 'AU',
            documentType: 'TAX_INVOICE',
          },
        })
      : [],
    refundIds.length
      ? db.paymentTransaction.findMany({
          where: {
            id: { in: refundIds },
            organizationId: branding.id,
            bookingId: capability.bookingId,
          },
          select: {
            id: true,
            bookingId: true,
            commercialAmendmentId: true,
            kind: true,
            status: true,
            currency: true,
            amountMinor: true,
            sourceProviderReference: true,
            createdAt: true,
          },
        })
      : [],
    amendmentIds.length
      ? db.hospitalityBookingCommercialAmendment.findMany({
          where: {
            id: { in: amendmentIds },
            organizationId: branding.id,
            bookingId: capability.bookingId,
          },
          select: {
            id: true,
            bookingId: true,
            status: true,
            direction: true,
            appliedAt: true,
            currency: true,
            beforeAccommodationSubtotalMinor: true,
            beforeTaxTotalMinor: true,
            beforeFeeTotalMinor: true,
            beforeAddonTotalMinor: true,
            beforeTotalMinor: true,
            afterAccommodationSubtotalMinor: true,
            afterTaxTotalMinor: true,
            afterFeeTotalMinor: true,
            afterAddonTotalMinor: true,
            afterTotalMinor: true,
            beforePricingFingerprint: true,
            afterPricingFingerprint: true,
          },
        })
      : [],
    targetEvidenceIds.length
      ? db.hospitalityBookingPricingEvidence.findMany({
          where: {
            id: { in: targetEvidenceIds },
            organizationId: branding.id,
            bookingId: capability.bookingId,
          },
          select: {
            id: true,
            bookingId: true,
            commercialAmendmentId: true,
            source: true,
            currency: true,
            accommodationSubtotalMinor: true,
            taxTotalMinor: true,
            feeTotalMinor: true,
            addonTotalMinor: true,
            totalMinor: true,
            pricingFingerprint: true,
            pricingBreakdown: true,
          },
        })
      : [],
  ]);

  const sourceById = new Map(sourceInvoices.map((entry) => [entry.id, entry]));
  const refundById = new Map(refunds.map((entry) => [entry.id, entry]));
  const amendmentById = new Map(amendments.map((entry) => [entry.id, entry]));
  const targetById = new Map(targetEvidenceRows.map((entry) => [entry.id, entry]));

  const adjustmentItems = validatedAdjustments.map((item) => {
    const sourceInvoice = sourceById.get(item.snapshot.sourceInvoiceId);
    validateAdjustmentSourceInvoice(item, sourceInvoice);
    if (!sourceInvoice) {
      throw new PublicIssuedTaxInvoicePersistenceError('Adjustment-note source tax invoice failed integrity validation.');
    }
    if (item.kind === 'BOOKING_CANCELLATION') {
      validateCancellationAuthority(item, refundById.get(item.snapshot.refundTransactionId));
    } else {
      validateCommercialAuthority(
        item,
        sourceInvoice,
        amendmentById.get(item.snapshot.commercialAmendmentId),
        targetById.get(item.snapshot.targetPricingEvidenceId),
      );
    }
    return customerAdjustmentDocument(item.document);
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
