import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import {
  parseHospitalityBookingPricingEvidenceBreakdown,
} from '../bookings/booking-pricing-evidence-domain.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT,
  createHospitalityAdjustmentNoteAccountingCsv,
} from './hospitality-adjustment-note-accounting-export-domain.ts';
import {
  hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-adjustment-note-domain.ts';
import {
  createHospitalityIssuedAdjustmentNoteDocument,
  HospitalityIssuedAdjustmentNoteDocumentValidationError,
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

const AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN = /^AU-ADJ-[0-9]{8,}$/;
const AUSTRALIAN_ADJUSTMENT_NOTE_WHERE = Object.freeze({
  jurisdictionCode: 'AU',
  documentType: 'ADJUSTMENT_NOTE',
} as const);

export class HospitalityIssuedAdjustmentNoteUnavailableError extends Error {
  constructor(message = 'Issued adjustment note is not available.') {
    super(message);
    this.name = 'HospitalityIssuedAdjustmentNoteUnavailableError';
  }
}

export class HospitalityIssuedAdjustmentNotePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityIssuedAdjustmentNotePersistenceError';
  }
}

export class HospitalityIssuedAdjustmentNoteExportLimitError extends Error {
  constructor() {
    super(`Accounting export cannot exceed ${HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT} adjustment notes.`);
    this.name = 'HospitalityIssuedAdjustmentNoteExportLimitError';
  }
}

type PersistedAdjustmentNote = {
  id: string;
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

type PersistedSourceInvoice = {
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

async function requireAdjustmentNoteReadAccess(input: { organizationId: string; actorUserId: string }) {
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:read',
  });
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:read',
  });
}

function validateCancellationRow(row: PersistedAdjustmentNote): ValidatedCancellation {
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
    throw new HospitalityIssuedAdjustmentNotePersistenceError(
      'Persisted cancellation adjustment note failed integrity validation.',
    );
  }
  const document = createHospitalityIssuedAdjustmentNoteDocument(snapshot);
  if (document.documentFingerprint !== row.documentFingerprint) {
    throw new HospitalityIssuedAdjustmentNotePersistenceError(
      'Cancellation adjustment-note document projection failed integrity validation.',
    );
  }
  return Object.freeze({ kind: 'BOOKING_CANCELLATION', row, snapshot, document });
}

function validateCommercialAmendmentRow(row: PersistedAdjustmentNote): ValidatedCommercialAmendment {
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
    throw new HospitalityIssuedAdjustmentNotePersistenceError(
      'Persisted commercial-amendment adjustment note failed integrity validation.',
    );
  }
  const document = createHospitalityIssuedAdjustmentNoteDocument(snapshot);
  if (document.documentFingerprint !== row.documentFingerprint) {
    throw new HospitalityIssuedAdjustmentNotePersistenceError(
      'Commercial-amendment adjustment-note document projection failed integrity validation.',
    );
  }
  return Object.freeze({ kind: 'COMMERCIAL_AMENDMENT', row, snapshot, document });
}

function validatePersistedAdjustmentNote(row: PersistedAdjustmentNote): ValidatedAdjustmentNote {
  try {
    if (row.adjustmentReason === 'BOOKING_CANCELLATION') return validateCancellationRow(row);
    if (row.adjustmentReason === 'COMMERCIAL_AMENDMENT') return validateCommercialAmendmentRow(row);
    throw new HospitalityIssuedAdjustmentNotePersistenceError('Unsupported persisted adjustment-note reason.');
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNotePersistenceError) throw error;
    if (error instanceof HospitalityIssuedAdjustmentNoteDocumentValidationError || error instanceof Error) {
      throw new HospitalityIssuedAdjustmentNotePersistenceError(error.message);
    }
    throw new HospitalityIssuedAdjustmentNotePersistenceError('Persisted adjustment note is invalid.');
  }
}

function pageNumber(value: number | undefined, fallback: number, label: string, maximum: number) {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new RangeError(`${label} must be between 1 and ${maximum}.`);
  }
  return normalized;
}

function validateSourceInvoice(item: ValidatedAdjustmentNote, sourceInvoice: PersistedSourceInvoice | undefined) {
  if (!sourceInvoice) {
    throw new HospitalityIssuedAdjustmentNotePersistenceError(
      'Adjustment-note source tax invoice failed integrity validation.',
    );
  }
  try {
    const snapshot = parseHospitalityIssuedTaxInvoiceSnapshot(sourceInvoice.documentSnapshot);
    const document = createHospitalityIssuedTaxInvoiceDocument(snapshot);
    if (
      sourceInvoice.organizationId !== item.row.organizationId
      || sourceInvoice.bookingId !== item.row.bookingId
      || sourceInvoice.jurisdictionCode !== 'AU'
      || sourceInvoice.documentType !== 'TAX_INVOICE'
      || snapshot.organizationId !== sourceInvoice.organizationId
      || snapshot.bookingId !== sourceInvoice.bookingId
      || snapshot.preparationId !== sourceInvoice.preparationId
      || snapshot.pricingEvidenceId !== sourceInvoice.pricingEvidenceId
      || snapshot.issuerProfileId !== sourceInvoice.issuerProfileId
      || snapshot.documentNumber !== sourceInvoice.documentNumber
      || BigInt(snapshot.sequenceValue) !== sourceInvoice.sequenceValue
      || new Date(snapshot.issuedAt).getTime() !== sourceInvoice.issuedAt.getTime()
      || snapshot.currency !== sourceInvoice.currency
      || BigInt(snapshot.accommodationSubtotalMinor) !== sourceInvoice.accommodationSubtotalMinor
      || BigInt(snapshot.taxTotalMinor) !== sourceInvoice.taxTotalMinor
      || BigInt(snapshot.feeTotalMinor) !== sourceInvoice.feeTotalMinor
      || BigInt(snapshot.addonTotalMinor) !== sourceInvoice.addonTotalMinor
      || BigInt(snapshot.totalMinor) !== sourceInvoice.totalMinor
      || snapshot.preparationFingerprint !== sourceInvoice.preparationFingerprint
      || snapshot.pricingFingerprint !== sourceInvoice.pricingFingerprint
      || snapshot.issuerFingerprint !== sourceInvoice.issuerFingerprint
      || snapshot.recipientFingerprint !== sourceInvoice.recipientFingerprint
      || hospitalityIssuedInvoiceFingerprint(snapshot) !== sourceInvoice.documentFingerprint
      || document.documentFingerprint !== sourceInvoice.documentFingerprint
      || sourceInvoice.documentFingerprint !== item.row.sourceInvoiceFingerprint
      || sourceInvoice.issuerFingerprint !== item.row.issuerFingerprint
      || sourceInvoice.recipientFingerprint !== item.row.recipientFingerprint
      || sourceInvoice.documentNumber !== item.snapshot.sourceInvoiceDocumentNumber
      || sourceInvoice.issuedAt.getTime() !== new Date(item.snapshot.sourceInvoiceIssuedAt).getTime()
    ) {
      throw new HospitalityIssuedAdjustmentNotePersistenceError(
        'Adjustment-note source tax invoice failed integrity validation.',
      );
    }
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNotePersistenceError) throw error;
    if (error instanceof HospitalityIssuedInvoiceDocumentValidationError || error instanceof Error) {
      throw new HospitalityIssuedAdjustmentNotePersistenceError(error.message);
    }
    throw new HospitalityIssuedAdjustmentNotePersistenceError(
      'Adjustment-note source tax invoice failed integrity validation.',
    );
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
    throw new HospitalityIssuedAdjustmentNotePersistenceError(
      'Cancellation adjustment-note refund authority failed integrity validation.',
    );
  }
}

function validateCommercialAuthority(
  item: ValidatedCommercialAmendment,
  sourceInvoice: PersistedSourceInvoice,
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
    throw new HospitalityIssuedAdjustmentNotePersistenceError(
      'Commercial-amendment adjustment-note authority failed integrity validation.',
    );
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
    throw new HospitalityIssuedAdjustmentNotePersistenceError(
      'Commercial-amendment target pricing authority failed integrity validation.',
    );
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
      throw new HospitalityIssuedAdjustmentNotePersistenceError(
        'Commercial-amendment target pricing breakdown failed immutable validation.',
      );
    }
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNotePersistenceError) throw error;
    throw new HospitalityIssuedAdjustmentNotePersistenceError(
      error instanceof Error ? error.message : 'Commercial-amendment target pricing breakdown is invalid.',
    );
  }
}

async function validateRowsWithAuthorities(organizationId: string, rows: PersistedAdjustmentNote[]) {
  const validated = rows.map(validatePersistedAdjustmentNote);
  const sourceInvoiceIds = [...new Set(validated.map(({ row }) => row.sourceInvoiceId))];
  const refundIds = [...new Set(
    validated
      .filter((item): item is ValidatedCancellation => item.kind === 'BOOKING_CANCELLATION')
      .map((item) => item.snapshot.refundTransactionId),
  )];
  const commercialItems = validated.filter(
    (item): item is ValidatedCommercialAmendment => item.kind === 'COMMERCIAL_AMENDMENT',
  );
  const amendmentIds = [...new Set(commercialItems.map((item) => item.snapshot.commercialAmendmentId))];
  const targetEvidenceIds = [...new Set(commercialItems.map((item) => item.snapshot.targetPricingEvidenceId))];

  const [sourceInvoices, refunds, amendments, targetEvidenceRows] = await Promise.all([
    sourceInvoiceIds.length
      ? db.hospitalityIssuedInvoice.findMany({
          where: {
            id: { in: sourceInvoiceIds },
            organizationId,
            jurisdictionCode: 'AU',
            documentType: 'TAX_INVOICE',
          },
          select: {
            id: true,
            organizationId: true,
            bookingId: true,
            preparationId: true,
            pricingEvidenceId: true,
            issuerProfileId: true,
            jurisdictionCode: true,
            documentType: true,
            documentNumber: true,
            sequenceValue: true,
            issuedAt: true,
            currency: true,
            accommodationSubtotalMinor: true,
            taxTotalMinor: true,
            feeTotalMinor: true,
            addonTotalMinor: true,
            totalMinor: true,
            preparationFingerprint: true,
            pricingFingerprint: true,
            issuerFingerprint: true,
            recipientFingerprint: true,
            documentFingerprint: true,
            documentSnapshot: true,
          },
        })
      : [],
    refundIds.length
      ? db.paymentTransaction.findMany({
          where: { id: { in: refundIds }, organizationId },
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
          where: { id: { in: amendmentIds }, organizationId },
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
          where: { id: { in: targetEvidenceIds }, organizationId },
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

  const sourceById = new Map(sourceInvoices.map((row) => [row.id, row]));
  const refundById = new Map(refunds.map((row) => [row.id, row]));
  const amendmentById = new Map(amendments.map((row) => [row.id, row]));
  const targetById = new Map(targetEvidenceRows.map((row) => [row.id, row]));

  for (const item of validated) {
    const sourceInvoice = sourceById.get(item.row.sourceInvoiceId);
    validateSourceInvoice(item, sourceInvoice);
    if (!sourceInvoice) {
      throw new HospitalityIssuedAdjustmentNotePersistenceError(
        'Adjustment-note source tax invoice failed integrity validation.',
      );
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
  }
  return validated;
}

function adjustmentSummary(item: Awaited<ReturnType<typeof validateRowsWithAuthorities>>[number]) {
  return Object.freeze({
    documentNumber: item.document.documentNumber,
    bookingId: item.document.bookingId,
    sourceTaxInvoiceNumber: item.document.sourceTaxInvoiceNumber,
    issuedAt: new Date(item.document.issuedAt),
    currency: item.document.currency,
    adjustmentReason: item.document.adjustmentReason,
    decreaseTotalMinor: BigInt(item.document.decreaseTotalMinor),
  });
}

export async function listHospitalityIssuedAdjustmentNotesForOrganization(input: {
  organizationId: string;
  actorUserId: string;
  page?: number;
  pageSize?: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireAdjustmentNoteReadAccess(input);

  const page = pageNumber(input.page, 1, 'page', 100_000);
  const pageSize = pageNumber(input.pageSize, 25, 'pageSize', 100);
  const where = { organizationId: input.organizationId, ...AUSTRALIAN_ADJUSTMENT_NOTE_WHERE } as const;
  const [total, rows] = await Promise.all([
    db.hospitalityIssuedAdjustmentNote.count({ where }),
    db.hospitalityIssuedAdjustmentNote.findMany({
      where,
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const validated = await validateRowsWithAuthorities(input.organizationId, rows);
  const items = validated.map(adjustmentSummary);
  return Object.freeze({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: Object.freeze(items),
  });
}

export async function createHospitalityIssuedAdjustmentNoteAccountingExport(input: {
  organizationId: string;
  actorUserId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireAdjustmentNoteReadAccess(input);

  const rows = await db.hospitalityIssuedAdjustmentNote.findMany({
    where: { organizationId: input.organizationId, ...AUSTRALIAN_ADJUSTMENT_NOTE_WHERE },
    orderBy: [{ issuedAt: 'asc' }, { sequenceValue: 'asc' }, { id: 'asc' }],
    take: HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT + 1,
  });
  if (rows.length > HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT) {
    throw new HospitalityIssuedAdjustmentNoteExportLimitError();
  }

  const validated = await validateRowsWithAuthorities(input.organizationId, rows);
  const accountingRows = validated.map(({ document }) => Object.freeze({
    documentNumber: document.documentNumber,
    issuedAt: new Date(document.issuedAt),
    bookingId: document.bookingId,
    sourceTaxInvoiceNumber: document.sourceTaxInvoiceNumber,
    sourceTaxInvoiceIssuedAt: new Date(document.sourceTaxInvoiceIssuedAt),
    currency: document.currency,
    adjustmentReason: document.adjustmentReason,
    decreaseSubtotalMinor: BigInt(document.decreaseSubtotalMinor),
    decreaseGstMinor: BigInt(document.decreaseGstMinor),
    decreaseTotalMinor: BigInt(document.decreaseTotalMinor),
  }));

  return Object.freeze({
    adjustmentNoteCount: accountingRows.length,
    csv: createHospitalityAdjustmentNoteAccountingCsv(accountingRows),
  });
}

export async function getHospitalityIssuedAdjustmentNoteDocument(input: {
  organizationId: string;
  actorUserId: string;
  documentNumber: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  const documentNumber = input.documentNumber.trim().toUpperCase();
  if (!AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN.test(documentNumber)) {
    throw new HospitalityIssuedAdjustmentNoteUnavailableError();
  }
  await requireAdjustmentNoteReadAccess(input);

  const row = await db.hospitalityIssuedAdjustmentNote.findFirst({
    where: {
      organizationId: input.organizationId,
      documentNumber,
      ...AUSTRALIAN_ADJUSTMENT_NOTE_WHERE,
    },
  });
  if (!row) throw new HospitalityIssuedAdjustmentNoteUnavailableError();
  const [validated] = await validateRowsWithAuthorities(input.organizationId, [row]);
  if (!validated) throw new HospitalityIssuedAdjustmentNoteUnavailableError();
  return validated.document;
}

export async function getHospitalityIssuedCancellationAdjustmentNoteDocument(input: {
  organizationId: string;
  actorUserId: string;
  documentNumber: string;
}) {
  const document = await getHospitalityIssuedAdjustmentNoteDocument(input);
  if (document.adjustmentReason !== 'Booking cancellation') {
    throw new HospitalityIssuedAdjustmentNoteUnavailableError();
  }
  return document;
}
