import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  canonicalHospitalityIssuedAdjustmentNoteJson,
  createHospitalityIssuedCancellationAdjustmentNoteSnapshot,
  formatAustralianAdjustmentNoteDocumentNumber,
  hospitalityIssuedAdjustmentNoteFingerprint,
  parseHospitalityIssuedCancellationAdjustmentNoteSnapshot,
} from './hospitality-issued-adjustment-note-domain.ts';
import {
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';

export class HospitalityAdjustmentNoteUnavailableError extends Error {
  constructor(message = 'Cancellation adjustment note is not available.') {
    super(message);
    this.name = 'HospitalityAdjustmentNoteUnavailableError';
  }
}

export class HospitalityAdjustmentNoteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityAdjustmentNoteConflictError';
  }
}

export class HospitalityAdjustmentNotePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityAdjustmentNotePersistenceError';
  }
}

export class HospitalityAdjustmentNoteWriteConflictError extends Error {
  constructor() {
    super('Cancellation adjustment-note issuance changed concurrently. Retry the operation.');
    this.name = 'HospitalityAdjustmentNoteWriteConflictError';
  }
}

const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return null;
  return error.code;
}

function isRetryableWrite(error: unknown) {
  const code = prismaErrorCode(error);
  return code === 'P2002' || code === 'P2034';
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(canonicalHospitalityIssuedAdjustmentNoteJson(value)) as Prisma.InputJsonValue;
}

function normalizeSourceInvoiceNumber(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN.test(normalized)) throw new HospitalityAdjustmentNoteUnavailableError();
  return normalized;
}

function validateSourceInvoice(row: {
  id: string;
  organizationId: string;
  bookingId: string;
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
  preparationId: string;
  pricingEvidenceId: string;
  issuerProfileId: string;
  preparationFingerprint: string;
  pricingFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  documentFingerprint: string;
  documentSnapshot: Prisma.JsonValue;
}) {
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
      throw new HospitalityAdjustmentNotePersistenceError('Source tax invoice failed integrity validation.');
    }
    return snapshot;
  } catch (error) {
    if (error instanceof HospitalityAdjustmentNotePersistenceError) throw error;
    throw new HospitalityAdjustmentNotePersistenceError(error instanceof Error ? error.message : 'Source tax invoice is invalid.');
  }
}

function validatePersistedAdjustmentNote(row: {
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  refundTransactionId: string;
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
}) {
  try {
    const snapshot = parseHospitalityIssuedCancellationAdjustmentNoteSnapshot(row.documentSnapshot);
    if (
      row.jurisdictionCode !== 'AU'
      || row.documentType !== 'ADJUSTMENT_NOTE'
      || row.adjustmentReason !== 'BOOKING_CANCELLATION'
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
      throw new HospitalityAdjustmentNotePersistenceError('Persisted cancellation adjustment note failed integrity validation.');
    }
    return snapshot;
  } catch (error) {
    if (error instanceof HospitalityAdjustmentNotePersistenceError) throw error;
    throw new HospitalityAdjustmentNotePersistenceError(error instanceof Error ? error.message : 'Persisted cancellation adjustment note is invalid.');
  }
}

async function requireAdjustmentManageAccess(input: { organizationId: string; actorUserId: string }) {
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });
}

async function findSourceInvoice(transaction: Prisma.TransactionClient, input: {
  organizationId: string;
  bookingId: string;
  sourceInvoiceDocumentNumber: string;
}) {
  const row = await transaction.hospitalityIssuedInvoice.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      jurisdictionCode: 'AU',
      documentType: 'TAX_INVOICE',
      documentNumber: input.sourceInvoiceDocumentNumber,
    },
  });
  if (!row) throw new HospitalityAdjustmentNoteUnavailableError();
  return { row, snapshot: validateSourceInvoice(row) };
}

function eligibleRefundWhere(input: { organizationId: string; bookingId: string; currency: string; totalMinor: bigint }) {
  return {
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    commercialAmendmentId: null,
    kind: 'REFUND' as const,
    status: 'SUCCEEDED' as const,
    currency: input.currency,
    amountMinor: input.totalMinor,
    sourceProviderReference: { not: null },
  };
}

export async function getHospitalityCancellationAdjustmentNoteAvailability(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  sourceInvoiceDocumentNumber: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const sourceInvoiceDocumentNumber = normalizeSourceInvoiceNumber(input.sourceInvoiceDocumentNumber);
  await requireAdjustmentManageAccess(input);

  return db.$transaction(async (transaction) => {
    const { row: sourceInvoice } = await findSourceInvoice(transaction, { ...input, sourceInvoiceDocumentNumber });
    const existing = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
      where: { organizationId: input.organizationId, sourceInvoiceId: sourceInvoice.id },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
    });
    if (existing) {
      validatePersistedAdjustmentNote(existing);
      return Object.freeze({ available: false as const, reason: 'A cancellation adjustment note has already been issued for this tax invoice.', documentNumber: existing.documentNumber });
    }

    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { status: true, paymentStatus: true },
    });
    if (!booking || booking.status !== 'CANCELLED' || booking.paymentStatus !== 'REFUNDED') {
      return Object.freeze({ available: false as const, reason: 'The booking must be cancelled and fully refunded before an adjustment note can be issued.' });
    }

    const refunds = await transaction.paymentTransaction.findMany({
      where: eligibleRefundWhere({ organizationId: input.organizationId, bookingId: input.bookingId, currency: sourceInvoice.currency, totalMinor: sourceInvoice.totalMinor }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
      select: { id: true },
    });
    if (refunds.length !== 1) {
      return Object.freeze({ available: false as const, reason: refunds.length === 0
        ? 'A single attributed successful full-refund transaction matching the tax invoice is required.'
        : 'Multiple matching full refunds make adjustment-note authority ambiguous.' });
    }
    return Object.freeze({ available: true as const, refundTransactionId: refunds[0]!.id });
  }, { isolationLevel: 'Serializable' });
}

export async function issueHospitalityCancellationAdjustmentNote(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  sourceInvoiceDocumentNumber: string;
  refundTransactionId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.refundTransactionId, 'refundTransactionId');
  const sourceInvoiceDocumentNumber = normalizeSourceInvoiceNumber(input.sourceInvoiceDocumentNumber);
  await requireAdjustmentManageAccess(input);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(async (transaction) => {
        const existing = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
          where: { organizationId: input.organizationId, refundTransactionId: input.refundTransactionId },
        });
        if (existing) {
          const snapshot = validatePersistedAdjustmentNote(existing);
          if (snapshot.bookingId !== input.bookingId || snapshot.sourceInvoiceDocumentNumber !== sourceInvoiceDocumentNumber) {
            throw new HospitalityAdjustmentNoteConflictError('Refund transaction is already bound to a different adjustment note.');
          }
          return existing;
        }

        const { row: sourceInvoice, snapshot: sourceSnapshot } = await findSourceInvoice(transaction, { ...input, sourceInvoiceDocumentNumber });
        const previous = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
          where: { organizationId: input.organizationId, sourceInvoiceId: sourceInvoice.id },
        });
        if (previous) {
          validatePersistedAdjustmentNote(previous);
          throw new HospitalityAdjustmentNoteConflictError('A cancellation adjustment note has already been issued for this tax invoice.');
        }

        const booking = await transaction.hospitalityBooking.findFirst({
          where: { id: input.bookingId, organizationId: input.organizationId },
          select: { status: true, paymentStatus: true },
        });
        if (!booking || booking.status !== 'CANCELLED' || booking.paymentStatus !== 'REFUNDED') {
          throw new HospitalityAdjustmentNoteConflictError('The booking must be cancelled and fully refunded before an adjustment note can be issued.');
        }

        const refund = await transaction.paymentTransaction.findFirst({
          where: { id: input.refundTransactionId, ...eligibleRefundWhere({ organizationId: input.organizationId, bookingId: input.bookingId, currency: sourceInvoice.currency, totalMinor: sourceInvoice.totalMinor }) },
          select: { id: true },
        });
        if (!refund) {
          throw new HospitalityAdjustmentNoteConflictError('The selected transaction is not an attributed successful full refund for this tax invoice.');
        }

        const sequence = await transaction.hospitalityInvoiceNumberSequence.upsert({
          where: {
            organizationId_jurisdictionCode_documentType: {
              organizationId: input.organizationId,
              jurisdictionCode: 'AU',
              documentType: 'ADJUSTMENT_NOTE',
            },
          },
          create: { organizationId: input.organizationId, jurisdictionCode: 'AU', documentType: 'ADJUSTMENT_NOTE', nextValue: 2n },
          update: { nextValue: { increment: 1n } },
          select: { nextValue: true },
        });
        const sequenceValue = sequence.nextValue - 1n;
        const documentNumber = formatAustralianAdjustmentNoteDocumentNumber(sequenceValue);
        const issuedAt = new Date();
        const snapshot = createHospitalityIssuedCancellationAdjustmentNoteSnapshot({
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          sourceInvoiceId: sourceInvoice.id,
          sourceInvoiceDocumentNumber,
          sourceInvoiceIssuedAt: sourceInvoice.issuedAt,
          refundTransactionId: refund.id,
          documentNumber,
          sequenceValue,
          issuedAt,
          currency: sourceInvoice.currency,
          decreaseTotalMinor: sourceInvoice.totalMinor,
          sourceInvoiceFingerprint: sourceInvoice.documentFingerprint,
          issuerFingerprint: sourceInvoice.issuerFingerprint,
          recipientFingerprint: sourceInvoice.recipientFingerprint,
          issuer: sourceSnapshot.issuer,
          recipient: sourceSnapshot.recipient,
          supplierAbn: sourceSnapshot.australianTax.supplierAbn,
        });
        const documentFingerprint = hospitalityIssuedAdjustmentNoteFingerprint(snapshot);
        const created = await transaction.hospitalityIssuedAdjustmentNote.create({
          data: {
            organizationId: input.organizationId,
            bookingId: input.bookingId,
            sourceInvoiceId: sourceInvoice.id,
            refundTransactionId: refund.id,
            jurisdictionCode: 'AU',
            documentType: 'ADJUSTMENT_NOTE',
            documentNumber,
            sequenceValue,
            issuedByUserId: input.actorUserId,
            issuedAt,
            currency: sourceInvoice.currency,
            adjustmentReason: 'BOOKING_CANCELLATION',
            decreaseSubtotalMinor: BigInt(snapshot.decreaseSubtotalMinor),
            decreaseTaxMinor: BigInt(snapshot.decreaseTaxMinor),
            decreaseTotalMinor: BigInt(snapshot.decreaseTotalMinor),
            sourceInvoiceFingerprint: sourceInvoice.documentFingerprint,
            issuerFingerprint: sourceInvoice.issuerFingerprint,
            recipientFingerprint: sourceInvoice.recipientFingerprint,
            documentFingerprint,
            documentSnapshot: toJsonInput(snapshot),
          },
        });
        validatePersistedAdjustmentNote(created);

        await transaction.auditEvent.create({
          data: {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            action: 'payment.adjustment-note.issued',
            resourceType: 'hospitality-issued-adjustment-note',
            resourceId: created.id,
            afterData: {
              bookingId: input.bookingId,
              sourceInvoiceDocumentNumber,
              documentNumber,
              adjustmentReason: 'BOOKING_CANCELLATION',
              currency: sourceInvoice.currency,
              decreaseTotalMinor: sourceInvoice.totalMinor.toString(),
              documentFingerprint,
            },
          },
        });
        return created;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (
        error instanceof HospitalityAdjustmentNoteUnavailableError
        || error instanceof HospitalityAdjustmentNoteConflictError
        || error instanceof HospitalityAdjustmentNotePersistenceError
      ) throw error;
      if (!isRetryableWrite(error)) throw error;
      if (attempt === 2) throw new HospitalityAdjustmentNoteWriteConflictError();
    }
  }
  throw new HospitalityAdjustmentNoteWriteConflictError();
}
