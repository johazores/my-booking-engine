import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalityIssuedAdjustmentNotePersistenceError,
  listHospitalityIssuedAdjustmentNotesForOrganization,
} from './hospitality-issued-adjustment-note-read-service.ts';
import {
  HospitalityIssuedInvoicePersistenceError,
  listHospitalityIssuedTaxInvoicesForOrganization,
} from './hospitality-issued-invoice-read-service.ts';
import {
  HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_AUDIT_ACTION,
  HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT,
  HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_RESOURCE_ID,
  HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_RESOURCE_TYPE,
  createHospitalityTaxDocumentReconciliationAuditData,
  createHospitalityTaxDocumentReconciliationResult,
  parseHospitalityTaxDocumentReconciliationAuditData,
  type HospitalityTaxDocumentReconciliationFailure,
} from './hospitality-tax-document-reconciliation-domain.ts';

const RECONCILIATION_PAGE_SIZE = 100;

export class HospitalityTaxDocumentReconciliationLimitError extends Error {
  constructor() {
    super(`Synchronous tax-document reconciliation cannot exceed ${HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT} issued documents.`);
    this.name = 'HospitalityTaxDocumentReconciliationLimitError';
  }
}

export class HospitalityTaxDocumentReconciliationHistoryError extends Error {
  constructor(message = 'Stored tax-document reconciliation history is invalid.') {
    super(message);
    this.name = 'HospitalityTaxDocumentReconciliationHistoryError';
  }
}

async function requireReconciliationAccess(input: { organizationId: string; actorUserId: string }) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:read' });
}

function pageNumber(value: number | undefined, fallback: number, label: string, maximum: number) {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new RangeError(`${label} must be between 1 and ${maximum}.`);
  }
  return normalized;
}

async function currentCounts(organizationId: string) {
  const [taxInvoiceCount, adjustmentNoteCount] = await Promise.all([
    db.hospitalityIssuedInvoice.count({ where: { organizationId, jurisdictionCode: 'AU', documentType: 'TAX_INVOICE' } }),
    db.hospitalityIssuedAdjustmentNote.count({ where: { organizationId, jurisdictionCode: 'AU', documentType: 'ADJUSTMENT_NOTE' } }),
  ]);
  return { taxInvoiceCount, adjustmentNoteCount };
}

async function validateTaxInvoiceRegister(input: { organizationId: string; actorUserId: string; expectedTotal: number }) {
  const totalPages = Math.max(1, Math.ceil(input.expectedTotal / RECONCILIATION_PAGE_SIZE));
  for (let page = 1; page <= totalPages; page += 1) {
    const result = await listHospitalityIssuedTaxInvoicesForOrganization({ organizationId: input.organizationId, actorUserId: input.actorUserId, page, pageSize: RECONCILIATION_PAGE_SIZE });
    if (result.total !== input.expectedTotal) return false;
  }
  return true;
}

async function validateAdjustmentNoteRegister(input: { organizationId: string; actorUserId: string; expectedTotal: number }) {
  const totalPages = Math.max(1, Math.ceil(input.expectedTotal / RECONCILIATION_PAGE_SIZE));
  for (let page = 1; page <= totalPages; page += 1) {
    const result = await listHospitalityIssuedAdjustmentNotesForOrganization({ organizationId: input.organizationId, actorUserId: input.actorUserId, page, pageSize: RECONCILIATION_PAGE_SIZE });
    if (result.total !== input.expectedTotal) return false;
  }
  return true;
}

export async function reconcileHospitalityAustralianTaxDocuments(input: { organizationId: string; actorUserId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireReconciliationAccess(input);

  const before = await currentCounts(input.organizationId);
  if (before.taxInvoiceCount + before.adjustmentNoteCount > HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT) {
    throw new HospitalityTaxDocumentReconciliationLimitError();
  }

  const failures: HospitalityTaxDocumentReconciliationFailure[] = [];
  try {
    const stableInvoices = await validateTaxInvoiceRegister({ ...input, expectedTotal: before.taxInvoiceCount });
    if (!stableInvoices) failures.push({ documentType: 'REGISTER', documentNumber: null, code: 'CONCURRENT_CHANGE' });
  } catch (error) {
    if (error instanceof HospitalityIssuedInvoicePersistenceError) failures.push({ documentType: 'TAX_INVOICE', documentNumber: null, code: 'INTEGRITY_CHECK_FAILED' });
    else throw error;
  }

  try {
    const stableAdjustments = await validateAdjustmentNoteRegister({ ...input, expectedTotal: before.adjustmentNoteCount });
    if (!stableAdjustments) failures.push({ documentType: 'REGISTER', documentNumber: null, code: 'CONCURRENT_CHANGE' });
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNotePersistenceError) failures.push({ documentType: 'ADJUSTMENT_NOTE', documentNumber: null, code: 'SOURCE_LINK_FAILED' });
    else throw error;
  }

  const after = await currentCounts(input.organizationId);
  if (after.taxInvoiceCount !== before.taxInvoiceCount || after.adjustmentNoteCount !== before.adjustmentNoteCount) {
    failures.push({ documentType: 'REGISTER', documentNumber: null, code: 'CONCURRENT_CHANGE' });
  }

  const report = createHospitalityTaxDocumentReconciliationResult({ checkedAt: new Date(), taxInvoiceCount: before.taxInvoiceCount, adjustmentNoteCount: before.adjustmentNoteCount, failures });
  const auditData = createHospitalityTaxDocumentReconciliationAuditData(report);
  await db.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_AUDIT_ACTION,
      resourceType: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_RESOURCE_TYPE,
      resourceId: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_RESOURCE_ID,
      afterData: { ...auditData, failureCodes: [...auditData.failureCodes] },
    },
  });
  return report;
}

export async function listHospitalityTaxDocumentReconciliationHistory(input: {
  organizationId: string;
  actorUserId: string;
  page?: number;
  pageSize?: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireReconciliationAccess(input);

  const requestedPage = pageNumber(input.page, 1, 'page', 100_000);
  const pageSize = pageNumber(input.pageSize, 20, 'pageSize', 100);
  const where = {
    organizationId: input.organizationId,
    action: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_AUDIT_ACTION,
    resourceType: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_RESOURCE_TYPE,
    resourceId: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_RESOURCE_ID,
  } as const;
  const total = await db.auditEvent.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const events = await db.auditEvent.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: { id: true, createdAt: true, afterData: true },
  });

  const items = events.map((event) => {
    const report = parseHospitalityTaxDocumentReconciliationAuditData(event.afterData);
    if (!report) throw new HospitalityTaxDocumentReconciliationHistoryError();
    return Object.freeze({ id: event.id, recordedAt: event.createdAt, report });
  });
  return Object.freeze({ page, pageSize, total, totalPages, items: Object.freeze(items) });
}
