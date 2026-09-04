import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import {
  deriveHospitalityCommercialAmendmentSettlementState,
} from '../bookings/booking-commercial-amendment-settlement-domain.ts';
import {
  parseHospitalityBookingPricingEvidenceBreakdown,
} from '../bookings/booking-pricing-evidence-domain.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalityCommercialAmendmentAdjustmentChainIntegrityError,
} from './hospitality-commercial-amendment-adjustment-chain-domain.ts';
import {
  HospitalityCommercialAmendmentAdjustmentChainLimitError,
  HospitalityCommercialAmendmentAdjustmentChainUnavailableError,
  loadVerifiedHospitalityCommercialAmendmentAdjustmentChain,
  selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite,
} from './hospitality-commercial-amendment-adjustment-chain-service.ts';
import {
  assessAustralianCommercialAmendmentAdjustmentReadiness,
  type AustralianCommercialAmendmentAdjustmentPrice,
} from './hospitality-commercial-amendment-adjustment-domain.ts';
import {
  HospitalityCommercialAmendmentAdjustmentNoteConflictError,
  HospitalityCommercialAmendmentAdjustmentNotePersistenceError,
  HospitalityCommercialAmendmentAdjustmentNoteUnavailableError,
  HospitalityCommercialAmendmentAdjustmentNoteWriteConflictError,
} from './hospitality-commercial-amendment-adjustment-note-service.ts';
import {
  createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot,
  hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint,
} from './hospitality-commercial-amendment-adjustment-note-domain.ts';
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
    throw new HospitalityCommercialAmendmentAdjustmentNoteUnavailableError();
  }
  return normalized;
}

function price(row: {
  currency: string;
  accommodationSubtotalMinor: bigint;
  taxTotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  totalMinor: bigint;
  pricingFingerprint: string;
}): AustralianCommercialAmendmentAdjustmentPrice {
  return Object.freeze({
    currency: row.currency,
    accommodationSubtotalMinor: row.accommodationSubtotalMinor,
    taxTotalMinor: row.taxTotalMinor,
    feeTotalMinor: row.feeTotalMinor,
    addonTotalMinor: row.addonTotalMinor,
    totalMinor: row.totalMinor,
    pricingFingerprint: row.pricingFingerprint,
  });
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
      snapshot.organizationId !== row.organizationId
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
      throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
        'Source tax invoice failed immutable evidence validation.',
      );
    }
    return snapshot;
  } catch (error) {
    if (error instanceof HospitalityCommercialAmendmentAdjustmentNotePersistenceError) throw error;
    throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
      error instanceof Error ? error.message : 'Source tax invoice evidence is invalid.',
    );
  }
}

function validateTargetPricingEvidence(row: {
  id: string;
  source: string;
  commercialAmendmentId: string | null;
  currency: string;
  accommodationSubtotalMinor: bigint;
  taxTotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  totalMinor: bigint;
  pricingFingerprint: string;
  pricingBreakdown: Prisma.JsonValue;
}, amendmentId: string) {
  try {
    const breakdown = parseHospitalityBookingPricingEvidenceBreakdown(row.pricingBreakdown);
    if (
      row.source !== 'COMMERCIAL_AMENDMENT_TARGET'
      || row.commercialAmendmentId !== amendmentId
      || breakdown.currency !== row.currency
      || BigInt(breakdown.accommodationSubtotalMinor) !== row.accommodationSubtotalMinor
      || BigInt(breakdown.taxTotalMinor) !== row.taxTotalMinor
      || BigInt(breakdown.feeTotalMinor) !== row.feeTotalMinor
      || BigInt(breakdown.addonTotalMinor) !== row.addonTotalMinor
      || BigInt(breakdown.totalMinor) !== row.totalMinor
      || breakdown.pricingFingerprint !== row.pricingFingerprint
    ) {
      throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
        'Commercial-amendment target pricing evidence failed immutable validation.',
      );
    }
    return Object.freeze({ id: row.id, price: price(row) });
  } catch (error) {
    if (error instanceof HospitalityCommercialAmendmentAdjustmentNotePersistenceError) throw error;
    throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
      error instanceof Error ? error.message : 'Commercial-amendment target pricing evidence is invalid.',
    );
  }
}

function firstReadinessFailure(readiness: ReturnType<typeof assessAustralianCommercialAmendmentAdjustmentReadiness>) {
  return readiness.requirements[0]?.message ?? 'Commercial-amendment adjustment evidence is not ready.';
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
      throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(error.message);
    }
    if (
      error instanceof HospitalityCommercialAmendmentAdjustmentChainUnavailableError
      || error instanceof HospitalityCommercialAmendmentAdjustmentChainIntegrityError
    ) {
      throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(error.message);
    }
    throw error;
  }
}

export async function issueHospitalityRepeatedCommercialAmendmentAdjustmentNote(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  sourceInvoiceDocumentNumber: string;
  commercialAmendmentId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.commercialAmendmentId, 'commercialAmendmentId');
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
        if (!sourceInvoice) throw new HospitalityCommercialAmendmentAdjustmentNoteUnavailableError();
        const sourceSnapshot = sourceInvoiceEvidence(sourceInvoice);

        const nonCommercialAdjustment = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
          where: {
            organizationId: input.organizationId,
            bookingId: input.bookingId,
            sourceInvoiceId: sourceInvoice.id,
            adjustmentReason: { not: 'COMMERCIAL_AMENDMENT' },
          },
          select: { id: true },
        });
        if (nonCommercialAdjustment) {
          throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(
            'A different legal adjustment already exists for this tax invoice.',
          );
        }

        const chain = await verifiedWriteChain({
          transaction,
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          sourceInvoiceId: sourceInvoice.id,
        });
        if (chain.priorAdjustmentNoteCount < 1 || !chain.head) {
          throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(
            'Repeated commercial-amendment issuance requires a verified predecessor adjustment note.',
          );
        }

        const existing = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
          where: {
            organizationId: input.organizationId,
            commercialAmendmentId: input.commercialAmendmentId,
          },
        });
        if (existing) {
          if (
            existing.bookingId !== input.bookingId
            || existing.sourceInvoiceId !== sourceInvoice.id
            || !chain.priorAdjustments.some((entry) => entry.adjustmentNoteId === existing.id)
          ) {
            throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(
              'Commercial amendment is already bound to a different adjustment note.',
            );
          }
          return existing;
        }

        const amendment = await transaction.hospitalityBookingCommercialAmendment.findFirst({
          where: {
            id: input.commercialAmendmentId,
            organizationId: input.organizationId,
            bookingId: input.bookingId,
          },
        });
        if (!amendment) throw new HospitalityCommercialAmendmentAdjustmentNoteUnavailableError();

        const targetRows = await transaction.hospitalityBookingPricingEvidence.findMany({
          where: {
            organizationId: input.organizationId,
            bookingId: input.bookingId,
            commercialAmendmentId: amendment.id,
            source: 'COMMERCIAL_AMENDMENT_TARGET',
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 2,
        });
        if (targetRows.length !== 1) {
          throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
            'Commercial amendment must have exactly one immutable target pricing-evidence record.',
          );
        }
        const target = validateTargetPricingEvidence(targetRows[0]!, amendment.id);

        const transactions = await transaction.paymentTransaction.findMany({
          where: {
            organizationId: input.organizationId,
            bookingId: input.bookingId,
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            kind: true,
            status: true,
            providerCode: true,
            providerReference: true,
            sourceProviderReference: true,
            currency: true,
            amountMinor: true,
            commercialAmendmentId: true,
          },
        });
        const settlement = deriveHospitalityCommercialAmendmentSettlementState({
          amendmentId: amendment.id,
          direction: amendment.direction,
          paymentProviderCode: amendment.paymentProviderCode,
          currency: amendment.currency,
          beforeTotalMinor: amendment.beforeTotalMinor,
          afterTotalMinor: amendment.afterTotalMinor,
          deltaMinor: amendment.deltaMinor,
          transactions,
        });

        const readiness = assessAustralianCommercialAmendmentAdjustmentReadiness({
          sourceInvoice: Object.freeze({ ...price(sourceInvoice), issuedAt: sourceInvoice.issuedAt }),
          amendment: {
            status: amendment.status,
            direction: amendment.direction,
            appliedAt: amendment.appliedAt,
            deltaMinor: amendment.deltaMinor,
            before: price({
              currency: amendment.currency,
              accommodationSubtotalMinor: amendment.beforeAccommodationSubtotalMinor,
              taxTotalMinor: amendment.beforeTaxTotalMinor,
              feeTotalMinor: amendment.beforeFeeTotalMinor,
              addonTotalMinor: amendment.beforeAddonTotalMinor,
              totalMinor: amendment.beforeTotalMinor,
              pricingFingerprint: amendment.beforePricingFingerprint,
            }),
            after: price({
              currency: amendment.currency,
              accommodationSubtotalMinor: amendment.afterAccommodationSubtotalMinor,
              taxTotalMinor: amendment.afterTaxTotalMinor,
              feeTotalMinor: amendment.afterFeeTotalMinor,
              addonTotalMinor: amendment.afterAddonTotalMinor,
              totalMinor: amendment.afterTotalMinor,
              pricingFingerprint: amendment.afterPricingFingerprint,
            }),
          },
          targetPricingEvidence: target.price,
          priorAdjustmentNoteCount: chain.priorAdjustmentNoteCount,
          priorAdjustments: chain.priorAdjustments,
          settlement: {
            state: settlement.state,
            settledAdjustmentMinor: settlement.state === 'CONFLICT' ? 0n : settlement.settledAdjustmentMinor,
            remainingAdjustmentMinor: settlement.state === 'CONFLICT' ? 0n : settlement.remainingAdjustmentMinor,
            netSettledMinor: settlement.state === 'CONFLICT' ? 0n : settlement.netSettledMinor,
          },
        });
        if (!readiness.contentReady) {
          throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(firstReadinessFailure(readiness));
        }
        if (
          readiness.expectedSourceAdjustmentOrdinal !== chain.expectedSourceAdjustmentOrdinal
          || readiness.predecessorAdjustmentNoteId !== chain.head.adjustmentNoteId
          || readiness.predecessorDocumentNumber !== chain.head.documentNumber
          || readiness.predecessorDocumentFingerprint !== chain.head.documentFingerprint
        ) {
          throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
            'Commercial-amendment readiness no longer matches the verified legal-document chain head.',
          );
        }
        if (!amendment.appliedAt) {
          throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError('Commercial amendment is not applied.');
        }

        const issuedAt = new Date();
        if (amendment.appliedAt.getTime() > issuedAt.getTime()) {
          throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(
            'Commercial amendment applied timestamp cannot be in the future.',
          );
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
        const sourceAdjustmentOrdinal = chain.expectedSourceAdjustmentOrdinal;
        const snapshot = createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          sourceInvoiceId: sourceInvoice.id,
          sourceInvoiceDocumentNumber,
          sourceInvoiceIssuedAt: sourceInvoice.issuedAt,
          commercialAmendmentId: amendment.id,
          commercialAmendmentAppliedAt: amendment.appliedAt,
          targetPricingEvidenceId: target.id,
          sourceAdjustmentOrdinal,
          predecessorAdjustment: {
            adjustmentNoteId: chain.head.adjustmentNoteId,
            sourceAdjustmentOrdinal: chain.head.sourceAdjustmentOrdinal,
            documentNumber: chain.head.documentNumber,
            issuedAt: chain.head.issuedAt,
            documentFingerprint: chain.head.documentFingerprint,
            afterPricingFingerprint: chain.head.afterPricingFingerprint,
          },
          documentNumber,
          sequenceValue,
          issuedAt,
          currency: sourceInvoice.currency,
          beforeTaxMinor: amendment.beforeTaxTotalMinor,
          beforeTotalMinor: amendment.beforeTotalMinor,
          afterTaxMinor: amendment.afterTaxTotalMinor,
          afterTotalMinor: amendment.afterTotalMinor,
          sourceInvoiceFingerprint: sourceInvoice.documentFingerprint,
          beforePricingFingerprint: amendment.beforePricingFingerprint,
          afterPricingFingerprint: amendment.afterPricingFingerprint,
          issuerFingerprint: sourceInvoice.issuerFingerprint,
          recipientFingerprint: sourceInvoice.recipientFingerprint,
          issuer: sourceSnapshot.issuer,
          recipient: sourceSnapshot.recipient,
          supplierAbn: sourceSnapshot.australianTax.supplierAbn,
        });
        const documentFingerprint = hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(snapshot);

        const created = await transaction.hospitalityIssuedAdjustmentNote.create({
          data: {
            organizationId: input.organizationId,
            bookingId: input.bookingId,
            sourceInvoiceId: sourceInvoice.id,
            refundTransactionId: null,
            commercialAmendmentId: amendment.id,
            targetPricingEvidenceId: target.id,
            predecessorAdjustmentNoteId: chain.head.adjustmentNoteId,
            predecessorSourceAdjustmentOrdinal: chain.head.sourceAdjustmentOrdinal,
            sourceAdjustmentOrdinal,
            jurisdictionCode: 'AU',
            documentType: 'ADJUSTMENT_NOTE',
            documentNumber,
            sequenceValue,
            issuedByUserId: input.actorUserId,
            issuedAt,
            currency: sourceInvoice.currency,
            adjustmentReason: 'COMMERCIAL_AMENDMENT',
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

        const reloadedChain = await loadVerifiedHospitalityCommercialAmendmentAdjustmentChain({
          transaction,
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          sourceInvoiceId: sourceInvoice.id,
        });
        if (
          reloadedChain.head?.adjustmentNoteId !== created.id
          || reloadedChain.expectedSourceAdjustmentOrdinal !== sourceAdjustmentOrdinal + 1
        ) {
          throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
            'Issued repeated adjustment note did not become the verified legal-document chain head.',
          );
        }

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
              commercialAmendmentId: amendment.id,
              targetPricingEvidenceId: target.id,
              sourceAdjustmentOrdinal,
              predecessorDocumentNumber: chain.head.documentNumber,
              documentNumber,
              adjustmentReason: 'COMMERCIAL_AMENDMENT',
              currency: sourceInvoice.currency,
              decreaseTotalMinor: snapshot.decreaseTotalMinor,
              documentFingerprint,
            },
          },
        });
        return created;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error instanceof HospitalityCommercialAmendmentAdjustmentNoteConflictError) throw error;
      if (error instanceof HospitalityCommercialAmendmentAdjustmentNoteUnavailableError) throw error;
      if (error instanceof HospitalityCommercialAmendmentAdjustmentNotePersistenceError) throw error;
      if (!isRetryableWrite(error)) throw error;
      if (attempt === 2) throw new HospitalityCommercialAmendmentAdjustmentNoteWriteConflictError();
    }
  }

  throw new HospitalityCommercialAmendmentAdjustmentNoteWriteConflictError();
}
