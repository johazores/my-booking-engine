import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness,
} from './hospitality-cancellation-after-amendment-adjustment-domain.ts';
import {
  verifyHospitalityCancellationAfterAmendmentAdjustmentRowInTransaction,
} from './hospitality-cancellation-after-amendment-adjustment-authority-service.ts';
import {
  createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot,
  hospitalityIssuedCancellationAfterAmendmentAdjustmentNoteFingerprint,
  parseHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot,
} from './hospitality-cancellation-after-amendment-adjustment-note-domain.ts';
import {
  HospitalityCommercialAmendmentAdjustmentChainIntegrityError,
} from './hospitality-commercial-amendment-adjustment-chain-domain.ts';
import {
  HospitalityCommercialAmendmentAdjustmentChainLimitError,
  HospitalityCommercialAmendmentAdjustmentChainUnavailableError,
  selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite,
} from './hospitality-commercial-amendment-adjustment-chain-service.ts';
import {
  canonicalHospitalityIssuedAdjustmentNoteJson,
  formatAustralianAdjustmentNoteDocumentNumber,
} from './hospitality-issued-adjustment-note-domain.ts';
import {
  createHospitalityIssuedTaxInvoiceDocument,
} from './hospitality-issued-invoice-document-domain.ts';
import {
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';

const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;

export class HospitalityCancellationAfterAmendmentAdjustmentNoteUnavailableError extends Error {
  constructor(message = 'Cancellation-after-amendment adjustment note is not available.') {
    super(message);
    this.name = 'HospitalityCancellationAfterAmendmentAdjustmentNoteUnavailableError';
  }
}

export class HospitalityCancellationAfterAmendmentAdjustmentNoteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityCancellationAfterAmendmentAdjustmentNoteConflictError';
  }
}

export class HospitalityCancellationAfterAmendmentAdjustmentNotePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityCancellationAfterAmendmentAdjustmentNotePersistenceError';
  }
}

export class HospitalityCancellationAfterAmendmentAdjustmentNoteWriteConflictError extends Error {
  constructor() {
    super('Cancellation-after-amendment issuance changed concurrently. Retry the operation.');
    this.name = 'HospitalityCancellationAfterAmendmentAdjustmentNoteWriteConflictError';
  }
}

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
  if (!AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN.test(normalized)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentNoteUnavailableError();
  }
  return normalized;
}

function sourceInvoiceEvidence(row: {
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
}) {
  try {
    const snapshot = parseHospitalityIssuedTaxInvoiceSnapshot(row.documentSnapshot);
    const document = createHospitalityIssuedTaxInvoiceDocument(snapshot);
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
      || document.documentFingerprint !== row.documentFingerprint
    ) {
      throw new HospitalityCancellationAfterAmendmentAdjustmentNotePersistenceError(
        'Source tax invoice failed immutable evidence validation.',
      );
    }
    return snapshot;
  } catch (error) {
    if (error instanceof HospitalityCancellationAfterAmendmentAdjustmentNotePersistenceError) throw error;
    throw new HospitalityCancellationAfterAmendmentAdjustmentNotePersistenceError(
      error instanceof Error ? error.message : 'Source tax invoice evidence is invalid.',
    );
  }
}

async function verifiedWriteChain(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
}) {
  try {
    return await selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite(input);
  } catch (error) {
    if (error instanceof HospitalityCommercialAmendmentAdjustmentChainLimitError) {
      throw new HospitalityCancellationAfterAmendmentAdjustmentNoteConflictError(error.message);
    }
    if (
      error instanceof HospitalityCommercialAmendmentAdjustmentChainUnavailableError
      || error instanceof HospitalityCommercialAmendmentAdjustmentChainIntegrityError
    ) {
      throw new HospitalityCancellationAfterAmendmentAdjustmentNotePersistenceError(error.message);
    }
    throw error;
  }
}

function isSchemaVersionSix(value: Prisma.JsonValue) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).schemaVersion === 6,
  );
}

export async function issueHospitalityCancellationAfterAmendmentAdjustmentNote(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  sourceInvoiceDocumentNumber: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const sourceInvoiceDocumentNumber = normalizeSourceInvoiceNumber(input.sourceInvoiceDocumentNumber);
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(async (transaction) => {
        const sourceInvoice = await transaction.hospitalityIssuedInvoice.findFirst({
          where: {
            organizationId: input.organizationId,
            bookingId: input.bookingId,
            jurisdictionCode: 'AU',
            documentType: 'TAX_INVOICE',
            documentNumber: sourceInvoiceDocumentNumber,
          },
        });
        if (!sourceInvoice) throw new HospitalityCancellationAfterAmendmentAdjustmentNoteUnavailableError();
        const sourceSnapshot = sourceInvoiceEvidence(sourceInvoice);

        const existingCancellation = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
          where: {
            organizationId: input.organizationId,
            bookingId: input.bookingId,
            sourceInvoiceId: sourceInvoice.id,
            adjustmentReason: 'BOOKING_CANCELLATION',
          },
          orderBy: [{ sourceAdjustmentOrdinal: 'desc' }, { issuedAt: 'desc' }, { id: 'desc' }],
        });
        if (existingCancellation) {
          if (!isSchemaVersionSix(existingCancellation.documentSnapshot)) {
            throw new HospitalityCancellationAfterAmendmentAdjustmentNoteConflictError(
              'A different cancellation adjustment-note contract already exists for this tax invoice.',
            );
          }
          await verifyHospitalityCancellationAfterAmendmentAdjustmentRowInTransaction({
            transaction,
            organizationId: input.organizationId,
            row: existingCancellation,
          });
          const snapshot = parseHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot(
            existingCancellation.documentSnapshot,
          );
          if (
            snapshot.bookingId !== input.bookingId
            || snapshot.sourceInvoiceDocumentNumber !== sourceInvoiceDocumentNumber
          ) {
            throw new HospitalityCancellationAfterAmendmentAdjustmentNoteConflictError(
              'Existing cancellation adjustment note belongs to a different legal source.',
            );
          }
          return existingCancellation;
        }

        const chain = await verifiedWriteChain({
          transaction,
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          sourceInvoiceId: sourceInvoice.id,
        });
        const head = chain.head;
        const priorHead = chain.priorAdjustments[chain.priorAdjustments.length - 1];
        if (!head || !priorHead) {
          throw new HospitalityCancellationAfterAmendmentAdjustmentNoteConflictError(
            'Cancellation-after-amendment requires a verified commercial predecessor chain.',
          );
        }

        const [booking, transactions] = await Promise.all([
          transaction.hospitalityBooking.findFirst({
            where: { id: input.bookingId, organizationId: input.organizationId },
            select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
          }),
          transaction.paymentTransaction.findMany({
            where: { organizationId: input.organizationId, bookingId: input.bookingId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              commercialAmendmentId: true,
              kind: true,
              status: true,
              providerCode: true,
              providerReference: true,
              sourceProviderReference: true,
              currency: true,
              amountMinor: true,
              createdAt: true,
            },
          }),
        ]);
        if (!booking) throw new HospitalityCancellationAfterAmendmentAdjustmentNoteUnavailableError();

        const readiness = deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness({
          bookingStatus: booking.status,
          bookingPaymentStatus: booking.paymentStatus,
          bookingCurrency: booking.currency,
          bookingTotalMinor: booking.totalMinor,
          chainHead: {
            adjustmentNoteId: head.adjustmentNoteId,
            sourceAdjustmentOrdinal: head.sourceAdjustmentOrdinal,
            documentNumber: head.documentNumber,
            issuedAt: head.issuedAt,
            documentFingerprint: head.documentFingerprint,
            afterPricingFingerprint: head.afterPricingFingerprint,
            currency: priorHead.after.currency,
            accommodationSubtotalMinor: priorHead.after.accommodationSubtotalMinor,
            taxTotalMinor: priorHead.after.taxTotalMinor,
            feeTotalMinor: priorHead.after.feeTotalMinor,
            addonTotalMinor: priorHead.after.addonTotalMinor,
            totalMinor: priorHead.after.totalMinor,
          },
          transactions,
        });
        if (!readiness.ready) {
          throw new HospitalityCancellationAfterAmendmentAdjustmentNoteConflictError(readiness.reason);
        }

        const sequence = await transaction.hospitalityInvoiceNumberSequence.upsert({
          where: {
            organizationId_jurisdictionCode_documentType: {
              organizationId: input.organizationId,
              jurisdictionCode: 'AU',
              documentType: 'ADJUSTMENT_NOTE',
            },
          },
          create: {
            organizationId: input.organizationId,
            jurisdictionCode: 'AU',
            documentType: 'ADJUSTMENT_NOTE',
            nextValue: 2n,
          },
          update: { nextValue: { increment: 1n } },
          select: { nextValue: true },
        });
        const sequenceValue = sequence.nextValue - 1n;
        const documentNumber = formatAustralianAdjustmentNoteDocumentNumber(sequenceValue);
        const issuedAt = new Date();
        const snapshot = createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot({
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          sourceInvoiceId: sourceInvoice.id,
          sourceInvoiceDocumentNumber,
          sourceInvoiceIssuedAt: sourceInvoice.issuedAt,
          sourceAdjustmentOrdinal: readiness.sourceAdjustmentOrdinal,
          predecessorAdjustmentNoteId: readiness.predecessorAdjustmentNoteId,
          predecessorAdjustmentDocumentNumber: readiness.predecessorAdjustmentDocumentNumber,
          predecessorAdjustmentIssuedAt: readiness.predecessorAdjustmentIssuedAt,
          predecessorAdjustmentDocumentFingerprint: readiness.predecessorAdjustmentDocumentFingerprint,
          predecessorAfterPricingFingerprint: readiness.predecessorAfterPricingFingerprint,
          beforePricingFingerprint: readiness.predecessorAfterPricingFingerprint,
          beforeTaxMinor: readiness.decreaseTaxMinor,
          beforeTotalMinor: readiness.decreaseTotalMinor,
          refundAuthorities: readiness.refundAuthorities,
          documentNumber,
          sequenceValue,
          issuedAt,
          currency: readiness.currency,
          sourceInvoiceFingerprint: sourceInvoice.documentFingerprint,
          issuerFingerprint: sourceInvoice.issuerFingerprint,
          recipientFingerprint: sourceInvoice.recipientFingerprint,
          issuer: sourceSnapshot.issuer,
          recipient: sourceSnapshot.recipient,
          supplierAbn: sourceSnapshot.australianTax.supplierAbn,
        });
        const documentFingerprint = hospitalityIssuedCancellationAfterAmendmentAdjustmentNoteFingerprint(snapshot);
        const created = await transaction.hospitalityIssuedAdjustmentNote.create({
          data: {
            organizationId: input.organizationId,
            bookingId: input.bookingId,
            sourceInvoiceId: sourceInvoice.id,
            refundTransactionId: null,
            commercialAmendmentId: null,
            targetPricingEvidenceId: null,
            predecessorAdjustmentNoteId: readiness.predecessorAdjustmentNoteId,
            predecessorSourceAdjustmentOrdinal: readiness.predecessorSourceAdjustmentOrdinal,
            sourceAdjustmentOrdinal: readiness.sourceAdjustmentOrdinal,
            jurisdictionCode: 'AU',
            documentType: 'ADJUSTMENT_NOTE',
            documentNumber,
            sequenceValue,
            issuedByUserId: input.actorUserId,
            issuedAt,
            currency: readiness.currency,
            adjustmentType: 'DECREASING',
            adjustmentReason: 'BOOKING_CANCELLATION',
            decreaseSubtotalMinor: readiness.decreaseSubtotalMinor,
            decreaseTaxMinor: readiness.decreaseTaxMinor,
            decreaseTotalMinor: readiness.decreaseTotalMinor,
            increaseSubtotalMinor: 0n,
            increaseTaxMinor: 0n,
            increaseTotalMinor: 0n,
            sourceInvoiceFingerprint: sourceInvoice.documentFingerprint,
            issuerFingerprint: sourceInvoice.issuerFingerprint,
            recipientFingerprint: sourceInvoice.recipientFingerprint,
            documentFingerprint,
            documentSnapshot: toJsonInput(snapshot),
          },
        });
        await verifyHospitalityCancellationAfterAmendmentAdjustmentRowInTransaction({
          transaction,
          organizationId: input.organizationId,
          row: created,
        });

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
              sourceAdjustmentOrdinal: readiness.sourceAdjustmentOrdinal,
              predecessorAdjustmentDocumentNumber: readiness.predecessorAdjustmentDocumentNumber,
              currency: readiness.currency,
              decreaseTotalMinor: readiness.decreaseTotalMinor.toString(),
              refundAuthorityCount: readiness.refundAuthorities.length,
              documentFingerprint,
            },
          },
        });
        return created;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (
        error instanceof HospitalityCancellationAfterAmendmentAdjustmentNoteUnavailableError
        || error instanceof HospitalityCancellationAfterAmendmentAdjustmentNoteConflictError
        || error instanceof HospitalityCancellationAfterAmendmentAdjustmentNotePersistenceError
      ) throw error;
      if (!isRetryableWrite(error)) throw error;
      if (attempt === 2) throw new HospitalityCancellationAfterAmendmentAdjustmentNoteWriteConflictError();
    }
  }
  throw new HospitalityCancellationAfterAmendmentAdjustmentNoteWriteConflictError();
}
