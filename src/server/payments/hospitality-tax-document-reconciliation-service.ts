import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  currentHospitalityCommercialAdjustmentSettlementDriftFailuresInTransaction,
} from './hospitality-commercial-adjustment-settlement-reconciliation-service.ts';
import {
  hospitalityIssuedCancellationAfterAmendmentAdjustmentNoteFingerprint,
  parseHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot,
} from './hospitality-cancellation-after-amendment-adjustment-note-domain.ts';
import {
  HospitalityIssuedAdjustmentNoteAuthorityError,
  validateHospitalityIssuedAdjustmentNoteRowsInTransaction,
} from './hospitality-issued-adjustment-note-authority-service.ts';
import {
  hospitalityIssuedAdjustmentNoteFingerprint,
  parseHospitalityIssuedCancellationAdjustmentNoteSnapshot,
} from './hospitality-issued-adjustment-note-domain.ts';
import {
  HospitalityIssuedInvoicePersistenceError,
  validateHospitalityIssuedTaxInvoiceRow,
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
import {
  findHospitalityTaxDocumentSettlementDrift,
  type HospitalityTaxDocumentSettlementAuthority,
} from './hospitality-tax-document-settlement-drift-domain.ts';

const RECONCILIATION_PAGE_SIZE = 100;
const AUSTRALIAN_TAX_INVOICE_WHERE = Object.freeze({
  jurisdictionCode: 'AU',
  documentType: 'TAX_INVOICE',
} as const);
const AUSTRALIAN_ADJUSTMENT_NOTE_WHERE = Object.freeze({
  jurisdictionCode: 'AU',
  documentType: 'ADJUSTMENT_NOTE',
} as const);

export class HospitalityTaxDocumentReconciliationLimitError extends Error {
  constructor(message = `Synchronous tax-document reconciliation cannot exceed ${HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT} issued documents.`) {
    super(message);
    this.name = 'HospitalityTaxDocumentReconciliationLimitError';
  }
}

export class HospitalityTaxDocumentReconciliationClockError extends Error {
  constructor() {
    super('Database clock is unavailable for tax-document reconciliation.');
    this.name = 'HospitalityTaxDocumentReconciliationClockError';
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

async function currentCountsInTransaction(transaction: Prisma.TransactionClient, organizationId: string) {
  const taxInvoiceCount = await transaction.hospitalityIssuedInvoice.count({
    where: { organizationId, ...AUSTRALIAN_TAX_INVOICE_WHERE },
  });
  const adjustmentNoteCount = await transaction.hospitalityIssuedAdjustmentNote.count({
    where: { organizationId, ...AUSTRALIAN_ADJUSTMENT_NOTE_WHERE },
  });
  return Object.freeze({ taxInvoiceCount, adjustmentNoteCount });
}

async function validateTaxInvoiceRegisterInTransaction(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  expectedTotal: number;
}) {
  const totalPages = Math.ceil(input.expectedTotal / RECONCILIATION_PAGE_SIZE);
  let validatedCount = 0;
  for (let page = 1; page <= totalPages; page += 1) {
    const rows = await input.transaction.hospitalityIssuedInvoice.findMany({
      where: { organizationId: input.organizationId, ...AUSTRALIAN_TAX_INVOICE_WHERE },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * RECONCILIATION_PAGE_SIZE,
      take: RECONCILIATION_PAGE_SIZE,
    });
    for (const row of rows) validateHospitalityIssuedTaxInvoiceRow(row);
    validatedCount += rows.length;
  }
  if (validatedCount !== input.expectedTotal) {
    throw new HospitalityIssuedInvoicePersistenceError('Issued tax-invoice register snapshot did not match its bounded count.');
  }
}

async function validateAdjustmentNoteRegisterInTransaction(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  expectedTotal: number;
}) {
  const totalPages = Math.ceil(input.expectedTotal / RECONCILIATION_PAGE_SIZE);
  let validatedCount = 0;
  for (let page = 1; page <= totalPages; page += 1) {
    const rows = await input.transaction.hospitalityIssuedAdjustmentNote.findMany({
      where: { organizationId: input.organizationId, ...AUSTRALIAN_ADJUSTMENT_NOTE_WHERE },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * RECONCILIATION_PAGE_SIZE,
      take: RECONCILIATION_PAGE_SIZE,
    });
    await validateHospitalityIssuedAdjustmentNoteRowsInTransaction({
      transaction: input.transaction,
      organizationId: input.organizationId,
      rows,
    });
    validatedCount += rows.length;
  }
  if (validatedCount !== input.expectedTotal) {
    throw new HospitalityIssuedAdjustmentNoteAuthorityError('Issued adjustment-note register snapshot did not match its bounded count.');
  }
}

async function currentCancellationRefundSettlementDriftFailuresInTransaction(
  transaction: Prisma.TransactionClient,
  organizationId: string,
) {
  const issued = await transaction.hospitalityIssuedAdjustmentNote.findMany({
    where: {
      organizationId,
      ...AUSTRALIAN_ADJUSTMENT_NOTE_WHERE,
      adjustmentReason: 'BOOKING_CANCELLATION',
    },
    select: {
      bookingId: true,
      sourceInvoiceId: true,
      documentNumber: true,
      sourceAdjustmentOrdinal: true,
      refundTransactionId: true,
      documentFingerprint: true,
      documentSnapshot: true,
    },
    orderBy: [{ documentNumber: 'asc' }, { id: 'asc' }],
    take: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT + 1,
  });
  if (issued.length > HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT) {
    throw new HospitalityTaxDocumentReconciliationLimitError();
  }

  const authorities: HospitalityTaxDocumentSettlementAuthority[] = [];
  for (const row of issued) {
    if (row.refundTransactionId) {
      try {
        const snapshot = parseHospitalityIssuedCancellationAdjustmentNoteSnapshot(row.documentSnapshot);
        if (
          snapshot.organizationId !== organizationId
          || snapshot.bookingId !== row.bookingId
          || snapshot.sourceInvoiceId !== row.sourceInvoiceId
          || snapshot.documentNumber !== row.documentNumber
          || snapshot.refundTransactionId !== row.refundTransactionId
          || hospitalityIssuedAdjustmentNoteFingerprint(snapshot) !== row.documentFingerprint
        ) continue;
        authorities.push(Object.freeze({
          documentNumber: row.documentNumber,
          refundTransactionIds: Object.freeze([row.refundTransactionId]),
        }));
      } catch {
        // The immutable adjustment-note read boundary owns malformed snapshot/source failures.
      }
      continue;
    }
    if (row.sourceAdjustmentOrdinal < 2) continue;
    try {
      const snapshot = parseHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot(row.documentSnapshot);
      if (
        snapshot.organizationId !== organizationId
        || snapshot.bookingId !== row.bookingId
        || snapshot.sourceInvoiceId !== row.sourceInvoiceId
        || snapshot.documentNumber !== row.documentNumber
        || Number(snapshot.sourceAdjustmentOrdinal) !== row.sourceAdjustmentOrdinal
        || hospitalityIssuedCancellationAfterAmendmentAdjustmentNoteFingerprint(snapshot) !== row.documentFingerprint
      ) continue;
      authorities.push(Object.freeze({
        documentNumber: row.documentNumber,
        refundTransactionIds: Object.freeze(snapshot.refundAuthorities.map((authority) => authority.refundTransactionId)),
      }));
    } catch {
      // The immutable adjustment-note read boundary owns malformed snapshot/source failures.
    }
  }
  if (authorities.length === 0) return Object.freeze([] as HospitalityTaxDocumentReconciliationFailure[]);

  const refundIds = [...new Set(authorities.flatMap((authority) => authority.refundTransactionIds))];
  const currentRefunds = refundIds.length === 0
    ? []
    : await transaction.paymentTransaction.findMany({
        where: { organizationId, id: { in: refundIds } },
        select: { id: true, status: true },
      });

  const drift = findHospitalityTaxDocumentSettlementDrift({ authorities, currentRefunds });
  return Object.freeze(drift.map((item): HospitalityTaxDocumentReconciliationFailure => Object.freeze({
    documentType: 'ADJUSTMENT_NOTE',
    documentNumber: item.documentNumber,
    code: 'SETTLEMENT_DRIFT',
  })));
}

export async function reconcileHospitalityAustralianTaxDocuments(input: { organizationId: string; actorUserId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireReconciliationAccess(input);

  return db.$transaction(async (transaction) => {
    const [databaseClock] = await transaction.$queryRaw<Array<{ checkedAt: Date }>>`
      SELECT date_trunc('milliseconds', clock_timestamp()) AS "checkedAt"
    `;
    const checkedAt = databaseClock?.checkedAt;
    if (!(checkedAt instanceof Date) || !Number.isFinite(checkedAt.getTime())) {
      throw new HospitalityTaxDocumentReconciliationClockError();
    }

    const counts = await currentCountsInTransaction(transaction, input.organizationId);
    if (counts.taxInvoiceCount + counts.adjustmentNoteCount > HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT) {
      throw new HospitalityTaxDocumentReconciliationLimitError();
    }

    const failures: HospitalityTaxDocumentReconciliationFailure[] = [];
    try {
      await validateTaxInvoiceRegisterInTransaction({
        transaction,
        organizationId: input.organizationId,
        expectedTotal: counts.taxInvoiceCount,
      });
    } catch (error) {
      if (error instanceof HospitalityIssuedInvoicePersistenceError) {
        failures.push({ documentType: 'TAX_INVOICE', documentNumber: null, code: 'INTEGRITY_CHECK_FAILED' });
      } else {
        throw error;
      }
    }

    try {
      await validateAdjustmentNoteRegisterInTransaction({
        transaction,
        organizationId: input.organizationId,
        expectedTotal: counts.adjustmentNoteCount,
      });
    } catch (error) {
      if (error instanceof HospitalityIssuedAdjustmentNoteAuthorityError) {
        failures.push({ documentType: 'ADJUSTMENT_NOTE', documentNumber: null, code: 'SOURCE_LINK_FAILED' });
      } else {
        throw error;
      }
    }

    failures.push(...await currentCancellationRefundSettlementDriftFailuresInTransaction(
      transaction,
      input.organizationId,
    ));

    const commercialSettlement = await currentHospitalityCommercialAdjustmentSettlementDriftFailuresInTransaction({
      transaction,
      organizationId: input.organizationId,
      documentLimit: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_LIMIT,
    });
    if (commercialSettlement.status === 'DOCUMENT_LIMIT_EXCEEDED') {
      throw new HospitalityTaxDocumentReconciliationLimitError();
    }
    if (commercialSettlement.status === 'TRANSACTION_LIMIT_EXCEEDED') {
      throw new HospitalityTaxDocumentReconciliationLimitError(
        'Commercial adjustment settlement reconciliation exceeded its bounded synchronous payment-history limit.',
      );
    }
    failures.push(...commercialSettlement.failures);

    const report = createHospitalityTaxDocumentReconciliationResult({
      checkedAt,
      taxInvoiceCount: counts.taxInvoiceCount,
      adjustmentNoteCount: counts.adjustmentNoteCount,
      failures,
    });
    const auditData = createHospitalityTaxDocumentReconciliationAuditData(report);
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_AUDIT_ACTION,
        resourceType: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_RESOURCE_TYPE,
        resourceId: HOSPITALITY_TAX_DOCUMENT_RECONCILIATION_RESOURCE_ID,
        createdAt: checkedAt,
        afterData: {
          ...auditData,
          failureCodes: [...auditData.failureCodes],
          failureCounts: auditData.failureCounts.map((item) => ({ ...item })),
        },
      },
    });
    return report;
  }, { isolationLevel: 'RepeatableRead' });
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

  return db.$transaction(async (transaction) => {
    const total = await transaction.auditEvent.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const events = await transaction.auditEvent.findMany({
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
  }, { isolationLevel: 'RepeatableRead' });
}
