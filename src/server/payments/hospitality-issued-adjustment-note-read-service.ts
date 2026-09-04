import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT,
  createHospitalityAdjustmentNoteAccountingCsv,
} from './hospitality-adjustment-note-accounting-export-domain.ts';
import {
  createHospitalityIssuedCancellationAdjustmentNoteDocument,
  HospitalityIssuedAdjustmentNoteDocumentValidationError,
} from './hospitality-issued-adjustment-note-document-domain.ts';
import {
  hospitalityIssuedAdjustmentNoteFingerprint,
  parseHospitalityIssuedCancellationAdjustmentNoteSnapshot,
} from './hospitality-issued-adjustment-note-domain.ts';

const AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN = /^AU-ADJ-[0-9]{8,}$/;
const AUSTRALIAN_CANCELLATION_ADJUSTMENT_NOTE_WHERE = Object.freeze({
  jurisdictionCode: 'AU',
  documentType: 'ADJUSTMENT_NOTE',
  adjustmentReason: 'BOOKING_CANCELLATION',
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
  bookingId: string;
  documentNumber: string;
  issuedAt: Date;
  documentFingerprint: string;
};

async function requireAdjustmentNoteReadAccess(input: { organizationId: string; actorUserId: string }) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:read' });
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
      throw new HospitalityIssuedAdjustmentNotePersistenceError('Persisted adjustment note failed integrity validation.');
    }
    return { snapshot, document: createHospitalityIssuedCancellationAdjustmentNoteDocument(snapshot) };
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

function validateSourceInvoice(
  row: PersistedAdjustmentNote,
  snapshot: ReturnType<typeof parseHospitalityIssuedCancellationAdjustmentNoteSnapshot>,
  sourceInvoice: PersistedSourceInvoice | undefined,
) {
  if (
    !sourceInvoice
    || sourceInvoice.bookingId !== row.bookingId
    || sourceInvoice.documentFingerprint !== row.sourceInvoiceFingerprint
    || sourceInvoice.documentNumber !== snapshot.sourceInvoiceDocumentNumber
    || sourceInvoice.issuedAt.getTime() !== new Date(snapshot.sourceInvoiceIssuedAt).getTime()
  ) {
    throw new HospitalityIssuedAdjustmentNotePersistenceError('Adjustment-note source tax invoice failed integrity validation.');
  }
}

async function validateRowsWithSourceInvoices(organizationId: string, rows: PersistedAdjustmentNote[]) {
  const validated = rows.map((row) => ({ row, ...validatePersistedAdjustmentNote(row) }));
  const sourceInvoiceIds = [...new Set(validated.map(({ row }) => row.sourceInvoiceId))];
  const sourceInvoices = sourceInvoiceIds.length
    ? await db.hospitalityIssuedInvoice.findMany({
        where: {
          id: { in: sourceInvoiceIds },
          organizationId,
          jurisdictionCode: 'AU',
          documentType: 'TAX_INVOICE',
        },
        select: { id: true, bookingId: true, documentNumber: true, issuedAt: true, documentFingerprint: true },
      })
    : [];
  const sourceById = new Map(sourceInvoices.map((source) => [source.id, source]));
  for (const item of validated) {
    validateSourceInvoice(item.row, item.snapshot, sourceById.get(item.row.sourceInvoiceId));
  }
  return validated;
}

function adjustmentSummary(item: Awaited<ReturnType<typeof validateRowsWithSourceInvoices>>[number]) {
  return Object.freeze({
    documentNumber: item.document.documentNumber,
    bookingId: item.document.bookingId,
    sourceTaxInvoiceNumber: item.document.sourceTaxInvoiceNumber,
    issuedAt: new Date(item.document.issuedAt),
    currency: item.document.currency,
    decreaseTotalMinor: BigInt(item.document.decreaseTotalMinor),
  });
}

export async function listHospitalityIssuedCancellationAdjustmentNotesForOrganization(input: {
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
  const where = { organizationId: input.organizationId, ...AUSTRALIAN_CANCELLATION_ADJUSTMENT_NOTE_WHERE } as const;
  const [total, rows] = await Promise.all([
    db.hospitalityIssuedAdjustmentNote.count({ where }),
    db.hospitalityIssuedAdjustmentNote.findMany({
      where,
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const validated = await validateRowsWithSourceInvoices(input.organizationId, rows);
  const items = validated.map(adjustmentSummary);
  return Object.freeze({ page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), items: Object.freeze(items) });
}

export async function createHospitalityIssuedAdjustmentNoteAccountingExport(input: {
  organizationId: string;
  actorUserId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireAdjustmentNoteReadAccess(input);

  const rows = await db.hospitalityIssuedAdjustmentNote.findMany({
    where: { organizationId: input.organizationId, ...AUSTRALIAN_CANCELLATION_ADJUSTMENT_NOTE_WHERE },
    orderBy: [{ issuedAt: 'asc' }, { sequenceValue: 'asc' }, { id: 'asc' }],
    take: HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT + 1,
  });
  if (rows.length > HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT) {
    throw new HospitalityIssuedAdjustmentNoteExportLimitError();
  }

  const validated = await validateRowsWithSourceInvoices(input.organizationId, rows);
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

export async function getHospitalityIssuedCancellationAdjustmentNoteDocument(input: {
  organizationId: string;
  actorUserId: string;
  documentNumber: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  const documentNumber = input.documentNumber.trim().toUpperCase();
  if (!AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN.test(documentNumber)) throw new HospitalityIssuedAdjustmentNoteUnavailableError();
  await requireAdjustmentNoteReadAccess(input);

  const row = await db.hospitalityIssuedAdjustmentNote.findFirst({
    where: { organizationId: input.organizationId, documentNumber, ...AUSTRALIAN_CANCELLATION_ADJUSTMENT_NOTE_WHERE },
  });
  if (!row) throw new HospitalityIssuedAdjustmentNoteUnavailableError();
  const validated = validatePersistedAdjustmentNote(row);

  const sourceInvoice = await db.hospitalityIssuedInvoice.findFirst({
    where: { id: row.sourceInvoiceId, organizationId: input.organizationId, bookingId: row.bookingId, jurisdictionCode: 'AU', documentType: 'TAX_INVOICE' },
    select: { id: true, bookingId: true, documentNumber: true, issuedAt: true, documentFingerprint: true },
  });
  validateSourceInvoice(row, validated.snapshot, sourceInvoice ?? undefined);
  return validated.document;
}
