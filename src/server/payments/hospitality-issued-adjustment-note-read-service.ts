import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT,
  createHospitalityAdjustmentNoteAccountingCsv,
} from './hospitality-adjustment-note-accounting-export-domain.ts';
import {
  HospitalityIssuedAdjustmentNoteAuthorityError,
  validateHospitalityIssuedAdjustmentNoteRows,
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

async function validateRowsWithAuthorities(organizationId: string, rows: Parameters<typeof validateHospitalityIssuedAdjustmentNoteRows>[0]['rows']) {
  try {
    return await validateHospitalityIssuedAdjustmentNoteRows({ organizationId, rows });
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNoteAuthorityError || error instanceof Error) {
      throw new HospitalityIssuedAdjustmentNotePersistenceError(error.message);
    }
    throw new HospitalityIssuedAdjustmentNotePersistenceError('Stored adjustment-note evidence failed integrity validation.');
  }
}

function adjustmentSummary(item: Awaited<ReturnType<typeof validateHospitalityIssuedAdjustmentNoteRows>>[number]) {
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
  return Object.freeze({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: Object.freeze(validated.map(adjustmentSummary)),
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
