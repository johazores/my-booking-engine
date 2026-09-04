import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HOSPITALITY_INVOICE_ACCOUNTING_EXPORT_LIMIT,
  createHospitalityInvoiceAccountingCsv,
} from './hospitality-invoice-accounting-export-domain.ts';
import {
  HospitalityIssuedInvoiceDocumentValidationError,
  createHospitalityIssuedTaxInvoiceDocument,
} from './hospitality-issued-invoice-document-domain.ts';
import {
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';

const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;
const AUSTRALIAN_TAX_INVOICE_WHERE = Object.freeze({ jurisdictionCode: 'AU', documentType: 'TAX_INVOICE' } as const);

export class HospitalityIssuedInvoiceUnavailableError extends Error {
  constructor(message = 'Issued tax invoice is not available.') {
    super(message);
    this.name = 'HospitalityIssuedInvoiceUnavailableError';
  }
}

export class HospitalityIssuedInvoicePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityIssuedInvoicePersistenceError';
  }
}

export class HospitalityIssuedInvoiceExportLimitError extends Error {
  constructor() {
    super(`Accounting export cannot exceed ${HOSPITALITY_INVOICE_ACCOUNTING_EXPORT_LIMIT} tax invoices.`);
    this.name = 'HospitalityIssuedInvoiceExportLimitError';
  }
}

type PersistedIssuedInvoice = {
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

async function requireIssuedInvoiceReadAccess(input: { organizationId: string; actorUserId: string }) {
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

function validatePersistedInvoice(row: PersistedIssuedInvoice) {
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
      throw new HospitalityIssuedInvoicePersistenceError('Persisted issued tax invoice failed integrity validation.');
    }
    return createHospitalityIssuedTaxInvoiceDocument(snapshot);
  } catch (error) {
    if (error instanceof HospitalityIssuedInvoicePersistenceError) throw error;
    if (error instanceof HospitalityIssuedInvoiceDocumentValidationError || error instanceof Error) {
      throw new HospitalityIssuedInvoicePersistenceError(error.message);
    }
    throw new HospitalityIssuedInvoicePersistenceError('Persisted issued tax invoice is invalid.');
  }
}

function pageNumber(value: number | undefined, fallback: number, label: string, maximum: number) {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new RangeError(`${label} must be between 1 and ${maximum}.`);
  }
  return normalized;
}

function invoiceSummary(row: PersistedIssuedInvoice) {
  const document = validatePersistedInvoice(row);
  return Object.freeze({
    documentNumber: document.documentNumber,
    bookingId: document.bookingId,
    issuedAt: new Date(document.issuedAt),
    currency: document.currency,
    totalMinor: BigInt(document.totalMinor),
  });
}

export async function listHospitalityIssuedTaxInvoices(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  page?: number;
  pageSize?: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireIssuedInvoiceReadAccess(input);

  const booking = await db.hospitalityBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!booking) throw new HospitalityIssuedInvoiceUnavailableError();

  const page = pageNumber(input.page, 1, 'page', 100_000);
  const pageSize = pageNumber(input.pageSize, 20, 'pageSize', 100);
  const where = { organizationId: input.organizationId, bookingId: input.bookingId, ...AUSTRALIAN_TAX_INVOICE_WHERE } as const;
  const [total, rows] = await Promise.all([
    db.hospitalityIssuedInvoice.count({ where }),
    db.hospitalityIssuedInvoice.findMany({ where, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const items = rows.map(invoiceSummary);
  return Object.freeze({ page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), items: Object.freeze(items) });
}

export async function listHospitalityIssuedTaxInvoicesForOrganization(input: {
  organizationId: string;
  actorUserId: string;
  page?: number;
  pageSize?: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireIssuedInvoiceReadAccess(input);

  const page = pageNumber(input.page, 1, 'page', 100_000);
  const pageSize = pageNumber(input.pageSize, 25, 'pageSize', 100);
  const where = { organizationId: input.organizationId, ...AUSTRALIAN_TAX_INVOICE_WHERE } as const;
  const [total, rows] = await Promise.all([
    db.hospitalityIssuedInvoice.count({ where }),
    db.hospitalityIssuedInvoice.findMany({ where, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const items = rows.map(invoiceSummary);
  return Object.freeze({ page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), items: Object.freeze(items) });
}

export async function createHospitalityIssuedTaxInvoiceAccountingExport(input: {
  organizationId: string;
  actorUserId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireIssuedInvoiceReadAccess(input);

  const rows = await db.hospitalityIssuedInvoice.findMany({
    where: { organizationId: input.organizationId, ...AUSTRALIAN_TAX_INVOICE_WHERE },
    orderBy: [{ issuedAt: 'asc' }, { sequenceValue: 'asc' }, { id: 'asc' }],
    take: HOSPITALITY_INVOICE_ACCOUNTING_EXPORT_LIMIT + 1,
  });
  if (rows.length > HOSPITALITY_INVOICE_ACCOUNTING_EXPORT_LIMIT) throw new HospitalityIssuedInvoiceExportLimitError();

  const accountingRows = rows.map((row) => {
    const document = validatePersistedInvoice(row);
    return Object.freeze({
      documentNumber: document.documentNumber,
      issuedAt: new Date(document.issuedAt),
      bookingId: document.bookingId,
      currency: document.currency,
      accommodationSubtotalMinor: BigInt(document.accommodationSubtotalMinor),
      feeTotalMinor: BigInt(document.feeTotalMinor),
      addonTotalMinor: BigInt(document.addonTotalMinor),
      taxTotalMinor: BigInt(document.gstMinor),
      totalMinor: BigInt(document.totalMinor),
    });
  });

  return Object.freeze({
    invoiceCount: accountingRows.length,
    csv: createHospitalityInvoiceAccountingCsv(accountingRows),
  });
}

export async function getHospitalityIssuedTaxInvoiceDocument(input: {
  organizationId: string;
  actorUserId: string;
  documentNumber: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  const documentNumber = input.documentNumber.trim().toUpperCase();
  if (!AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN.test(documentNumber)) throw new HospitalityIssuedInvoiceUnavailableError();
  await requireIssuedInvoiceReadAccess(input);

  const row = await db.hospitalityIssuedInvoice.findFirst({
    where: { organizationId: input.organizationId, documentNumber, ...AUSTRALIAN_TAX_INVOICE_WHERE },
  });
  if (!row) throw new HospitalityIssuedInvoiceUnavailableError();
  return validatePersistedInvoice(row);
}
