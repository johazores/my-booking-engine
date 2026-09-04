import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalityIssuedAdjustmentNotePersistenceError,
  listHospitalityIssuedCancellationAdjustmentNotesForOrganization,
} from './hospitality-issued-adjustment-note-read-service.ts';
import {
  HospitalityIssuedInvoicePersistenceError,
  listHospitalityIssuedTaxInvoicesForOrganization,
} from './hospitality-issued-invoice-read-service.ts';
import {
  HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT,
  createHospitalityTaxDocumentReconciliationResult,
  type HospitalityTaxDocumentReconciliationFailure,
} from './hospitality-tax-document-reconciliation-domain.ts';

const RECONCILIATION_PAGE_SIZE = 100;

export class HospitalityTaxDocumentReconciliationLimitError extends Error {
  constructor() {
    super(`Synchronous tax-document reconciliation cannot exceed ${HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT} issued documents.`);
    this.name = 'HospitalityTaxDocumentReconciliationLimitError';
  }
}

async function requireReconciliationAccess(input: { organizationId: string; actorUserId: string }) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:read' });
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
    const result = await listHospitalityIssuedCancellationAdjustmentNotesForOrganization({ organizationId: input.organizationId, actorUserId: input.actorUserId, page, pageSize: RECONCILIATION_PAGE_SIZE });
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

  return createHospitalityTaxDocumentReconciliationResult({ checkedAt: new Date(), taxInvoiceCount: before.taxInvoiceCount, adjustmentNoteCount: before.adjustmentNoteCount, failures });
}
