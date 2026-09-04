import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT,
  createHospitalityAdjustmentNoteAccountingCsv,
} from './hospitality-adjustment-note-accounting-export-domain.ts';
import {
  HospitalityCommercialAmendmentAdjustmentChainIntegrityError,
} from './hospitality-commercial-amendment-adjustment-chain-domain.ts';
import {
  HospitalityCommercialAmendmentAdjustmentChainLimitError,
  HospitalityCommercialAmendmentAdjustmentChainUnavailableError,
} from './hospitality-commercial-amendment-adjustment-chain-service.ts';
import {
  verifyHospitalityCommercialAmendmentAdjustmentRows,
} from './hospitality-commercial-amendment-adjustment-chain-read-service.ts';
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
  predecessorAdjustmentNoteId: string | null;
  predecessorSourceAdjustmentOrdinal: number | null;
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
    || row.predecessorAdjustmentNoteId !== null
    || row.predecessorSourceAdjustmentOrdinal !== null
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

function commercialPredecessorMatches(row: PersistedAdjustmentNote, snapshot: ReturnType<typeof parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot>) {
  if (snapshot.schemaVersion === 2) {
    return row.sourceAdjustmentOrdinal === 1
      && row.predecessorAdjustmentNoteId === null
      && row.predecessorSourceAdjustmentOrdinal === null;
  }
  return row.sourceAdjustmentOrdinal >= 2
    && row.predecessorAdjustmentNoteId === snapshot.predecessorAdjustmentNoteId
    && row.predecessorSourceAdjustmentOrdinal === row.sourceAdjustmentOrdinal - 1;
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

async function verifyCommercialAuthority(organizationId: string, items: readonly ValidatedCommercialAmendment[]) {
  if (items.length === 0) return;
  try {
    await verifyHospitalityCommercialAmendmentAdjustmentRows({
      organizationId,
      rows: items.map((item) => ({
        id: item.row.id,
        bookingId: item.row.bookingId,
        sourceInvoiceId: item.row.sourceInvoiceId,
      })),
    });
  } catch (error) {
    if (
      error instanceof HospitalityCommercialAmendmentAdjustmentChainUnavailableError
      || error instanceof HospitalityCommercialAmendmentAdjustmentChainIntegrityError
      || error instanceof HospitalityCommercialAmendmentAdjustmentChainLimitError
      || error instanceof Error
    ) {
      throw new HospitalityIssuedAdjustmentNotePersistenceError(error.message);
    }
    throw new HospitalityIssuedAdjustmentNotePersistenceError(
      'Commercial-amendment adjustment-note chain failed integrity validation.',
    );
  }
}

async function validateRowsWithAuthorities(organizationId: string, rows: PersistedAdjustmentNote[]) {
  const validated = rows.map(validatePersistedAdjustmentNote);
  const sourceInvoiceIds = [...new Set(validated.map(({ row }) => row.sourceInvoiceId))];
  const cancellationItems = validated.filter(
    (item): item is ValidatedCancellation => item.kind === 'BOOKING_CANCELLATION',
  );
  const commercialItems = validated.filter(
    (item): item is ValidatedCommercialAmendment => item.kind === 'COMMERCIAL_AMENDMENT',
  );
  const refundIds = [...new Set(cancellationItems.map((item) => item.snapshot.refundTransactionId))];

  const [sourceInvoices, refunds] = await Promise.all([
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
  ]);
  const sourceById = new Map(sourceInvoices.map((row) => [row.id, row]));
  const refundById = new Map(refunds.map((row) => [row.id, row]));

  for (const item of validated) {
    validateSourceInvoice(item, sourceById.get(item.row.sourceInvoiceId));
    if (item.kind === 'BOOKING_CANCELLATION') {
      validateCancellationAuthority(item, refundById.get(item.snapshot.refundTransactionId));
    }
  }
  await verifyCommercialAuthority(organizationId, commercialItems);
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
