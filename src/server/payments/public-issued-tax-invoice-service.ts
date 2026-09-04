import type { Prisma } from '../../generated/prisma/client.ts';
import {
  PublicBookingCapabilityConfigurationError,
  verifyPublicBookingBookingCapability,
} from '../bookings/public-booking-capability.ts';
import { PublicHospitalityBookingUnavailableError } from '../bookings/public-hospitality-search-service.ts';
import { readPublicOrganizationBrandingBySlug } from '../branding/branding-service.ts';
import { db } from '../database.ts';
import {
  verifyHospitalityCommercialAmendmentAdjustmentRows,
} from './hospitality-commercial-amendment-adjustment-chain-read-service.ts';
import {
  hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-adjustment-note-domain.ts';
import {
  HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError,
  HospitalityCommercialAmendmentIncreasingAdjustmentReadLimitError,
  verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows,
} from './hospitality-commercial-amendment-increasing-adjustment-read-service.ts';
import {
  hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-increasing-adjustment-note-domain.ts';
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
  id: string;
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  refundTransactionId: string | null;
  commercialAmendmentId: string | null;
  targetPricingEvidenceId: string | null;
  predecessorAdjustmentNoteId: string | null;
  predecessorSourceAdjustmentOrdinal: number | null;
  sourceAdjustmentOrdinal: number;
  jurisdictionCode: string;
  documentType: string;
  documentNumber: string;
  sequenceValue: bigint;
  issuedAt: Date;
  currency: string;
  adjustmentType: string;
  adjustmentReason: string;
  decreaseSubtotalMinor: bigint;
  decreaseTaxMinor: bigint;
  decreaseTotalMinor: bigint;
  increaseSubtotalMinor: bigint;
  increaseTaxMinor: bigint;
  increaseTotalMinor: bigint;
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

type ValidatedDecreasingCommercialAmendment = Readonly<{
  kind: 'COMMERCIAL_AMENDMENT_DECREASING';
  row: PersistedAdjustmentNote;
  snapshot: ReturnType<typeof parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot>;
  document: ReturnType<typeof createHospitalityIssuedAdjustmentNoteDocument>;
}>;

type ValidatedIncreasingCommercialAmendment = Readonly<{
  kind: 'COMMERCIAL_AMENDMENT_INCREASING';
  row: PersistedAdjustmentNote;
  snapshot: ReturnType<typeof parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot>;
  document: ReturnType<typeof createHospitalityIssuedAdjustmentNoteDocument>;
}>;

type ValidatedAdjustmentNote =
  | ValidatedCancellation
  | ValidatedDecreasingCommercialAmendment
  | ValidatedIncreasingCommercialAmendment;

function zeroIncrease(row: PersistedAdjustmentNote) {
  return row.increaseSubtotalMinor === 0n && row.increaseTaxMinor === 0n && row.increaseTotalMinor === 0n;
}

function zeroDecrease(row: PersistedAdjustmentNote) {
  return row.decreaseSubtotalMinor === 0n && row.decreaseTaxMinor === 0n && row.decreaseTotalMinor === 0n;
}

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
    ) throw new PublicIssuedTaxInvoicePersistenceError();

    const document = createHospitalityIssuedTaxInvoiceDocument(snapshot);
    if (document.documentFingerprint !== row.documentFingerprint) throw new PublicIssuedTaxInvoicePersistenceError();
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
    || row.adjustmentType !== 'DECREASING'
    || row.adjustmentReason !== 'BOOKING_CANCELLATION'
    || row.refundTransactionId === null
    || row.commercialAmendmentId !== null
    || row.targetPricingEvidenceId !== null
    || row.predecessorAdjustmentNoteId !== null
    || row.predecessorSourceAdjustmentOrdinal !== null
    || row.sourceAdjustmentOrdinal !== 1
    || !zeroIncrease(row)
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
  if (
    document.documentFingerprint !== row.documentFingerprint
    || document.adjustmentReason !== 'Booking cancellation'
    || document.adjustmentType !== 'Decreasing adjustment'
  ) {
    throw new PublicIssuedTaxInvoicePersistenceError('Cancellation adjustment-note document projection failed integrity validation.');
  }
  return Object.freeze({ kind: 'BOOKING_CANCELLATION', row, snapshot, document });
}

function commercialPredecessorMatches(
  row: PersistedAdjustmentNote,
  snapshot: ReturnType<typeof parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot>,
) {
  if (snapshot.schemaVersion === 2) {
    return row.sourceAdjustmentOrdinal === 1
      && row.predecessorAdjustmentNoteId === null
      && row.predecessorSourceAdjustmentOrdinal === null;
  }
  return row.sourceAdjustmentOrdinal >= 2
    && row.predecessorAdjustmentNoteId === snapshot.predecessorAdjustmentNoteId
    && row.predecessorSourceAdjustmentOrdinal === row.sourceAdjustmentOrdinal - 1;
}

function validateDecreasingCommercialAdjustmentNote(row: PersistedAdjustmentNote): ValidatedDecreasingCommercialAmendment {
  const snapshot = parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot(row.documentSnapshot);
  if (
    row.jurisdictionCode !== 'AU'
    || row.documentType !== 'ADJUSTMENT_NOTE'
    || row.adjustmentType !== 'DECREASING'
    || row.adjustmentReason !== 'COMMERCIAL_AMENDMENT'
    || row.refundTransactionId !== null
    || row.commercialAmendmentId === null
    || row.targetPricingEvidenceId === null
    || !zeroIncrease(row)
    || !commercialPredecessorMatches(row, snapshot)
    || snapshot.organizationId !== row.organizationId
    || snapshot.bookingId !== row.bookingId
    || snapshot.sourceInvoiceId !== row.sourceInvoiceId
    || snapshot.commercialAmendmentId !== row.commercialAmendmentId
    || snapshot.targetPricingEvidenceId !== row.targetPricingEvidenceId
    || snapshot.sourceAdjustmentOrdinal !== String(row.sourceAdjustmentOrdinal)
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
    throw new PublicIssuedTaxInvoicePersistenceError('Persisted decreasing commercial-amendment adjustment note failed integrity validation.');
  }
  const document = createHospitalityIssuedAdjustmentNoteDocument(snapshot);
  if (
    document.documentFingerprint !== row.documentFingerprint
    || document.adjustmentReason !== 'Commercial booking amendment'
    || document.adjustmentType !== 'Decreasing adjustment'
  ) {
    throw new PublicIssuedTaxInvoicePersistenceError('Decreasing commercial adjustment-note projection failed integrity validation.');
  }
  return Object.freeze({ kind: 'COMMERCIAL_AMENDMENT_DECREASING', row, snapshot, document });
}

function validateIncreasingCommercialAdjustmentNote(row: PersistedAdjustmentNote): ValidatedIncreasingCommercialAmendment {
  const snapshot = parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot(row.documentSnapshot);
  if (
    row.jurisdictionCode !== 'AU'
    || row.documentType !== 'ADJUSTMENT_NOTE'
    || row.adjustmentType !== 'INCREASING'
    || row.adjustmentReason !== 'COMMERCIAL_AMENDMENT'
    || row.refundTransactionId !== null
    || row.commercialAmendmentId === null
    || row.targetPricingEvidenceId === null
    || row.predecessorAdjustmentNoteId !== null
    || row.predecessorSourceAdjustmentOrdinal !== null
    || row.sourceAdjustmentOrdinal !== 1
    || !zeroDecrease(row)
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
    || BigInt(snapshot.increaseSubtotalMinor) !== row.increaseSubtotalMinor
    || BigInt(snapshot.increaseTaxMinor) !== row.increaseTaxMinor
    || BigInt(snapshot.increaseTotalMinor) !== row.increaseTotalMinor
    || snapshot.sourceInvoiceFingerprint !== row.sourceInvoiceFingerprint
    || snapshot.issuerFingerprint !== row.issuerFingerprint
    || snapshot.recipientFingerprint !== row.recipientFingerprint
    || hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint(snapshot) !== row.documentFingerprint
  ) {
    throw new PublicIssuedTaxInvoicePersistenceError('Persisted increasing commercial-amendment adjustment note failed integrity validation.');
  }
  const document = createHospitalityIssuedAdjustmentNoteDocument(snapshot);
  if (
    document.documentFingerprint !== row.documentFingerprint
    || document.adjustmentReason !== 'Commercial booking amendment'
    || document.adjustmentType !== 'Increasing adjustment'
  ) {
    throw new PublicIssuedTaxInvoicePersistenceError('Increasing commercial adjustment-note projection failed integrity validation.');
  }
  return Object.freeze({ kind: 'COMMERCIAL_AMENDMENT_INCREASING', row, snapshot, document });
}

function validatePersistedAdjustmentNote(row: PersistedAdjustmentNote): ValidatedAdjustmentNote {
  try {
    if (row.adjustmentReason === 'BOOKING_CANCELLATION' && row.adjustmentType === 'DECREASING') {
      return validateCancellationAdjustmentNote(row);
    }
    if (row.adjustmentReason === 'COMMERCIAL_AMENDMENT' && row.adjustmentType === 'DECREASING') {
      return validateDecreasingCommercialAdjustmentNote(row);
    }
    if (row.adjustmentReason === 'COMMERCIAL_AMENDMENT' && row.adjustmentType === 'INCREASING') {
      return validateIncreasingCommercialAdjustmentNote(row);
    }
    throw new PublicIssuedTaxInvoicePersistenceError('Unsupported persisted adjustment-note reason or direction.');
  } catch (error) {
    if (error instanceof PublicIssuedTaxInvoicePersistenceError) throw error;
    if (error instanceof HospitalityIssuedAdjustmentNoteDocumentValidationError || error instanceof Error) {
      throw new PublicIssuedTaxInvoicePersistenceError(error.message);
    }
    throw new PublicIssuedTaxInvoicePersistenceError();
  }
}

function validateAdjustmentSourceInvoice(item: ValidatedAdjustmentNote, sourceInvoice: PersistedInvoice | undefined) {
  if (!sourceInvoice) throw new PublicIssuedTaxInvoicePersistenceError('Adjustment-note source tax invoice failed integrity validation.');
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
    increaseSubtotalMinor: document.increaseSubtotalMinor,
    increaseGstMinor: document.increaseGstMinor,
    increaseTotalMinor: document.increaseTotalMinor,
  });
}

async function verifyCommercialAuthorities(
  organizationId: string,
  decreasing: readonly ValidatedDecreasingCommercialAmendment[],
  increasing: readonly ValidatedIncreasingCommercialAmendment[],
) {
  try {
    await Promise.all([
      verifyHospitalityCommercialAmendmentAdjustmentRows({
        organizationId,
        rows: decreasing.map((item) => ({
          id: item.row.id,
          bookingId: item.row.bookingId,
          sourceInvoiceId: item.row.sourceInvoiceId,
        })),
      }),
      verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows({
        organizationId,
        rows: increasing.map((item) => ({
          id: item.row.id,
          bookingId: item.row.bookingId,
          sourceInvoiceId: item.row.sourceInvoiceId,
        })),
      }),
    ]);
  } catch (error) {
    if (
      error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError
      || error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentReadLimitError
      || error instanceof Error
    ) {
      throw new PublicIssuedTaxInvoicePersistenceError(error.message);
    }
    throw new PublicIssuedTaxInvoicePersistenceError('Commercial adjustment-note authority failed integrity validation.');
  }
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
  const sourceInvoiceIds = [...new Set(validatedAdjustments.map(({ row }) => row.sourceInvoiceId))];
  const cancellationItems = validatedAdjustments.filter(
    (item): item is ValidatedCancellation => item.kind === 'BOOKING_CANCELLATION',
  );
  const decreasingItems = validatedAdjustments.filter(
    (item): item is ValidatedDecreasingCommercialAmendment => item.kind === 'COMMERCIAL_AMENDMENT_DECREASING',
  );
  const increasingItems = validatedAdjustments.filter(
    (item): item is ValidatedIncreasingCommercialAmendment => item.kind === 'COMMERCIAL_AMENDMENT_INCREASING',
  );
  const refundIds = [...new Set(cancellationItems.map((item) => item.snapshot.refundTransactionId))];

  const [sourceInvoices, refunds] = await Promise.all([
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
  ]);
  const sourceById = new Map(sourceInvoices.map((entry) => [entry.id, entry]));
  const refundById = new Map(refunds.map((entry) => [entry.id, entry]));

  for (const item of validatedAdjustments) {
    validateAdjustmentSourceInvoice(item, sourceById.get(item.row.sourceInvoiceId));
    if (item.kind === 'BOOKING_CANCELLATION') {
      validateCancellationAuthority(item, refundById.get(item.snapshot.refundTransactionId));
    }
  }
  await verifyCommercialAuthorities(branding.id, decreasingItems, increasingItems);

  const adjustmentItems = validatedAdjustments.map((item) => customerAdjustmentDocument(item.document));
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
