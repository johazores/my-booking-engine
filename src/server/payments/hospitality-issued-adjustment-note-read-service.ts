import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT,
  createHospitalityAdjustmentNoteAccountingCsv,
} from './hospitality-adjustment-note-accounting-export-domain.ts';
import {
  HospitalityIssuedAdjustmentNoteAuthorityError,
  validateHospitalityIssuedAdjustmentNoteRowsInTransaction,
} from './hospitality-issued-adjustment-note-authority-service.ts';

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

function pageNumber(value: number | undefined, fallback: number, label: string, maximum: number) {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new RangeError(`${label} must be between 1 and ${maximum}.`);
  }
  return normalized;
}

async function validateRowsWithAuthoritiesInTransaction(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  rows: Parameters<typeof validateHospitalityIssuedAdjustmentNoteRowsInTransaction>[0]['rows'],
) {
  try {
    return await validateHospitalityIssuedAdjustmentNoteRowsInTransaction({ transaction, organizationId, rows });
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNoteAuthorityError || error instanceof Error) {
      throw new HospitalityIssuedAdjustmentNotePersistenceError(error.message);
    }
    throw new HospitalityIssuedAdjustmentNotePersistenceError('Stored adjustment-note evidence failed integrity validation.');
  }
}

function adjustmentSummary(item: Awaited<ReturnType<typeof validateHospitalityIssuedAdjustmentNoteRowsInTransaction>>[number]) {
  return Object.freeze({
    documentNumber: item.document.documentNumber,
    bookingId: item.document.bookingId,
    sourceTaxInvoiceNumber: item.document.sourceTaxInvoiceNumber,
    issuedAt: new Date(item.document.issuedAt),
    currency: item.document.currency,
    adjustmentType: item.document.adjustmentType,
    adjustmentReason: item.document.adjustmentReason,
    decreaseTotalMinor: BigInt(item.document.decreaseTotalMinor),
    increaseTotalMinor: BigInt(item.document.increaseTotalMinor),
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

  const requestedPage = pageNumber(input.page, 1, 'page', 100_000);
  const pageSize = pageNumber(input.pageSize, 25, 'pageSize', 100);
  const where = { organizationId: input.organizationId, ...AUSTRALIAN_ADJUSTMENT_NOTE_WHERE } as const;
  const result = await db.$transaction(async (transaction) => {
    const total = await transaction.hospitalityIssuedAdjustmentNote.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const rows = await transaction.hospitalityIssuedAdjustmentNote.findMany({
      where,
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const validated = await validateRowsWithAuthoritiesInTransaction(transaction, input.organizationId, rows);
    return { page, total, totalPages, validated };
  }, { isolationLevel: 'RepeatableRead' });

  return Object.freeze({
    page: result.page,
    pageSize,
    total: result.total,
    totalPages: result.totalPages,
    items: Object.freeze(result.validated.map(adjustmentSummary)),
  });
}

export async function createHospitalityIssuedAdjustmentNoteAccountingExport(input: {
  organizationId: string;
  actorUserId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireAdjustmentNoteReadAccess(input);

  const validated = await db.$transaction(async (transaction) => {
    const rows = await transaction.hospitalityIssuedAdjustmentNote.findMany({
      where: { organizationId: input.organizationId, ...AUSTRALIAN_ADJUSTMENT_NOTE_WHERE },
      orderBy: [{ issuedAt: 'asc' }, { sequenceValue: 'asc' }, { id: 'asc' }],
      take: HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT + 1,
    });
    if (rows.length > HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT) {
      throw new HospitalityIssuedAdjustmentNoteExportLimitError();
    }
    return validateRowsWithAuthoritiesInTransaction(transaction, input.organizationId, rows);
  }, { isolationLevel: 'RepeatableRead' });
  const accountingRows = validated.map(({ document }) => {
    const common = {
      documentNumber: document.documentNumber,
      issuedAt: new Date(document.issuedAt),
      bookingId: document.bookingId,
      sourceTaxInvoiceNumber: document.sourceTaxInvoiceNumber,
      sourceTaxInvoiceIssuedAt: new Date(document.sourceTaxInvoiceIssuedAt),
      currency: document.currency,
      adjustmentReason: document.adjustmentReason,
    };
    if (document.adjustmentType === 'Increasing adjustment') {
      return Object.freeze({
        ...common,
        adjustmentType: 'Increasing adjustment' as const,
        decreaseSubtotalMinor: 0n as const,
        decreaseGstMinor: 0n as const,
        decreaseTotalMinor: 0n as const,
        increaseSubtotalMinor: BigInt(document.increaseSubtotalMinor),
        increaseGstMinor: BigInt(document.increaseGstMinor),
        increaseTotalMinor: BigInt(document.increaseTotalMinor),
      });
    }
    return Object.freeze({
      ...common,
      adjustmentType: 'Decreasing adjustment' as const,
      decreaseSubtotalMinor: BigInt(document.decreaseSubtotalMinor),
      decreaseGstMinor: BigInt(document.decreaseGstMinor),
      decreaseTotalMinor: BigInt(document.decreaseTotalMinor),
      increaseSubtotalMinor: 0n as const,
      increaseGstMinor: 0n as const,
      increaseTotalMinor: 0n as const,
    });
  });

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

  return db.$transaction(async (transaction) => {
    const row = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
      where: {
        organizationId: input.organizationId,
        documentNumber,
        ...AUSTRALIAN_ADJUSTMENT_NOTE_WHERE,
      },
    });
    if (!row) throw new HospitalityIssuedAdjustmentNoteUnavailableError();
    const [validated] = await validateRowsWithAuthoritiesInTransaction(transaction, input.organizationId, [row]);
    if (!validated) throw new HospitalityIssuedAdjustmentNoteUnavailableError();
    return validated.document;
  }, { isolationLevel: 'RepeatableRead' });
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
