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
  assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness,
  type AustralianCommercialAmendmentIncreasingAdjustmentPrice,
} from './hospitality-commercial-amendment-increasing-adjustment-domain.ts';
import {
  createHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot,
  hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-increasing-adjustment-note-domain.ts';
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

export class HospitalityCommercialAmendmentIncreasingAdjustmentNoteUnavailableError extends Error {
  constructor(message = 'Increasing commercial-amendment adjustment note is not available.') {
    super(message);
    this.name = 'HospitalityCommercialAmendmentIncreasingAdjustmentNoteUnavailableError';
  }
}

export class HospitalityCommercialAmendmentIncreasingAdjustmentNoteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityCommercialAmendmentIncreasingAdjustmentNoteConflictError';
  }
}

export class HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError';
  }
}

export class HospitalityCommercialAmendmentIncreasingAdjustmentNoteWriteConflictError extends Error {
  constructor() {
    super('Increasing commercial-amendment adjustment-note issuance changed concurrently. Retry the operation.');
    this.name = 'HospitalityCommercialAmendmentIncreasingAdjustmentNoteWriteConflictError';
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

async function requireAdjustmentManageAccess(input: { organizationId: string; actorUserId: string }) {
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });
}

function normalizeSourceInvoiceNumber(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN.test(normalized)) {
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentNoteUnavailableError();
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
}): AustralianCommercialAmendmentIncreasingAdjustmentPrice {
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

function validateSourceInvoice(row: {
  id: string;
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
      throw new HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError(
        'Source tax invoice failed immutable evidence validation.',
      );
    }

    return Object.freeze({
      snapshot,
      price: Object.freeze({ ...price(row), issuedAt: row.issuedAt }),
    });
  } catch (error) {
    if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError) throw error;
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError(
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
      throw new HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError(
        'Commercial-amendment target pricing evidence failed immutable validation.',
      );
    }
    return Object.freeze({ id: row.id, price: price(row) });
  } catch (error) {
    if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError) throw error;
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError(
      error instanceof Error ? error.message : 'Commercial-amendment target pricing evidence is invalid.',
    );
  }
}

function validatePersistedIncreasingAdjustmentNote(row: {
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  refundTransactionId: string | null;
  commercialAmendmentId: string | null;
  targetPricingEvidenceId: string | null;
  predecessorAdjustmentNoteId: string | null;
  predecessorSourceAdjustmentOrdinal: number | null;
  sourceAdjustmentOrdinal: number;
  jurisdictionCode: string;
  documentType: string;
  documentNumber: string;
  sequenceValue: bigint;
  issuedAt: Date;
  currency: string;
  adjustmentType: string;
  adjustmentReason: string;
  decreaseSubtotalMinor: bigint;
  decreaseTaxMinor: bigint;
  decreaseTotalMinor: bigint;
  increaseSubtotalMinor: bigint;
  increaseTaxMinor: bigint;
  increaseTotalMinor: bigint;
  sourceInvoiceFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  documentFingerprint: string;
  documentSnapshot: Prisma.JsonValue;
}) {
  try {
    const snapshot = parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot(row.documentSnapshot);
    if (
      row.jurisdictionCode !== 'AU'
      || row.documentType !== 'ADJUSTMENT_NOTE'
      || row.adjustmentType !== 'INCREASING'
      || row.adjustmentReason !== 'COMMERCIAL_AMENDMENT'
      || row.refundTransactionId !== null
      || row.commercialAmendmentId === null
      || row.targetPricingEvidenceId === null
      || row.predecessorAdjustmentNoteId !== null
      || row.predecessorSourceAdjustmentOrdinal !== null
      || row.sourceAdjustmentOrdinal !== 1
      || row.decreaseSubtotalMinor !== 0n
      || row.decreaseTaxMinor !== 0n
      || row.decreaseTotalMinor !== 0n
      || snapshot.organizationId !== row.organizationId
      || snapshot.bookingId !== row.bookingId
      || snapshot.sourceInvoiceId !== row.sourceInvoiceId
      || snapshot.commercialAmendmentId !== row.commercialAmendmentId
      || snapshot.targetPricingEvidenceId !== row.targetPricingEvidenceId
      || snapshot.sourceAdjustmentOrdinal !== '1'
      || snapshot.documentNumber !== row.documentNumber
      || BigInt(snapshot.sequenceValue) !== row.sequenceValue
      || new Date(snapshot.issuedAt).getTime() !== row.issuedAt.getTime()
      || snapshot.currency !== row.currency
      || BigInt(snapshot.increaseSubtotalMinor) !== row.increaseSubtotalMinor
      || BigInt(snapshot.increaseTaxMinor) !== row.increaseTaxMinor
      || BigInt(snapshot.increaseTotalMinor) !== row.increaseTotalMinor
      || snapshot.sourceInvoiceFingerprint !== row.sourceInvoiceFingerprint
      || snapshot.issuerFingerprint !== row.issuerFingerprint
      || snapshot.recipientFingerprint !== row.recipientFingerprint
      || hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint(snapshot) !== row.documentFingerprint
    ) {
      throw new HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError(
        'Persisted increasing commercial-amendment adjustment note failed integrity validation.',
      );
    }
    return snapshot;
  } catch (error) {
    if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError) throw error;
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError(
      error instanceof Error ? error.message : 'Persisted increasing commercial-amendment adjustment note is invalid.',
    );
  }
}

async function loadAssessmentEvidence(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    bookingId: string;
    sourceInvoiceDocumentNumber: string;
    commercialAmendmentId: string;
  },
) {
  const sourceInvoice = await transaction.hospitalityIssuedInvoice.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      jurisdictionCode: 'AU',
      documentType: 'TAX_INVOICE',
      documentNumber: input.sourceInvoiceDocumentNumber,
    },
  });
  if (!sourceInvoice) throw new HospitalityCommercialAmendmentIncreasingAdjustmentNoteUnavailableError();
  const source = validateSourceInvoice(sourceInvoice);

  const amendment = await transaction.hospitalityBookingCommercialAmendment.findFirst({
    where: {
      id: input.commercialAmendmentId,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    },
  });
  if (!amendment) throw new HospitalityCommercialAmendmentIncreasingAdjustmentNoteUnavailableError();

  const targetEvidenceRows = await transaction.hospitalityBookingPricingEvidence.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: amendment.id,
      source: 'COMMERCIAL_AMENDMENT_TARGET',
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 2,
  });
  if (targetEvidenceRows.length !== 1) {
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError(
      'Commercial amendment must have exactly one immutable target pricing-evidence record.',
    );
  }
  const target = validateTargetPricingEvidence(targetEvidenceRows[0]!, amendment.id);

  const [priorAdjustmentNoteCount, transactions, competingBaselineAmendmentCount] = await Promise.all([
    transaction.hospitalityIssuedAdjustmentNote.count({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        sourceInvoiceId: sourceInvoice.id,
      },
    }),
    transaction.paymentTransaction.findMany({
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
    }),
    transaction.hospitalityBookingCommercialAmendment.count({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        id: { not: amendment.id },
        status: 'APPLIED',
        direction: { in: ['REFUND', 'ADDITIONAL_CHARGE'] },
        currency: sourceInvoice.currency,
        beforeTotalMinor: sourceInvoice.totalMinor,
        beforePricingFingerprint: sourceInvoice.pricingFingerprint,
        appliedAt: { gte: sourceInvoice.issuedAt },
      },
    }),
  ]);
  if (competingBaselineAmendmentCount !== 0) {
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentNoteConflictError(
      'Multiple applied commercial amendments compete for the same source tax-invoice baseline.',
    );
  }

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
  const readiness = assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness({
    sourceInvoice: source.price,
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
    priorAdjustmentNoteCount,
    settlement: {
      state: settlement.state,
      settledAdjustmentMinor: settlement.state === 'CONFLICT' ? 0n : settlement.settledAdjustmentMinor,
      remainingAdjustmentMinor: settlement.state === 'CONFLICT' ? 0n : settlement.remainingAdjustmentMinor,
      netSettledMinor: settlement.state === 'CONFLICT' ? 0n : settlement.netSettledMinor,
    },
  });

  return Object.freeze({ sourceInvoice, source, amendment, target, readiness });
}

function firstReadinessFailure(readiness: Awaited<ReturnType<typeof loadAssessmentEvidence>>['readiness']) {
  return readiness.requirements[0]?.message ?? 'Increasing commercial-amendment adjustment evidence is not ready.';
}

export async function getHospitalityCommercialAmendmentIncreasingAdjustmentNoteAvailability(input: {
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
    const sourceInvoice = await transaction.hospitalityIssuedInvoice.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        jurisdictionCode: 'AU',
        documentType: 'TAX_INVOICE',
        documentNumber: sourceInvoiceDocumentNumber,
      },
    });
    if (!sourceInvoice) throw new HospitalityCommercialAmendmentIncreasingAdjustmentNoteUnavailableError();
    validateSourceInvoice(sourceInvoice);

    const existing = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        sourceInvoiceId: sourceInvoice.id,
      },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
    });
    if (existing) {
      if (existing.adjustmentType === 'INCREASING' && existing.adjustmentReason === 'COMMERCIAL_AMENDMENT') {
        validatePersistedIncreasingAdjustmentNote(existing);
        return Object.freeze({
          available: false as const,
          reason: 'An increasing commercial-amendment adjustment note has already been issued for this tax invoice.',
          documentNumber: existing.documentNumber,
        });
      }
      return Object.freeze({
        available: false as const,
        reason: 'A different legal adjustment already exists for this tax invoice.',
        documentNumber: existing.documentNumber,
      });
    }

    const candidates = await transaction.hospitalityBookingCommercialAmendment.findMany({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        status: 'APPLIED',
        direction: 'ADDITIONAL_CHARGE',
        currency: sourceInvoice.currency,
        beforeTotalMinor: sourceInvoice.totalMinor,
        beforePricingFingerprint: sourceInvoice.pricingFingerprint,
        appliedAt: { gte: sourceInvoice.issuedAt },
      },
      orderBy: [{ appliedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 2,
      select: { id: true },
    });
    if (candidates.length === 0) {
      return Object.freeze({
        available: false as const,
        reason: 'No applied increasing commercial amendment matches this immutable tax-invoice baseline.',
      });
    }
    if (candidates.length > 1) {
      return Object.freeze({
        available: false as const,
        reason: 'Multiple increasing commercial amendments match this tax-invoice baseline; adjustment authority is ambiguous.',
      });
    }

    const evidence = await loadAssessmentEvidence(transaction, {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      sourceInvoiceDocumentNumber,
      commercialAmendmentId: candidates[0]!.id,
    });
    if (!evidence.readiness.contentReady) {
      return Object.freeze({
        available: false as const,
        reason: firstReadinessFailure(evidence.readiness),
      });
    }
    return Object.freeze({
      available: true as const,
      commercialAmendmentId: evidence.amendment.id,
      sourceAdjustmentOrdinal: 1 as const,
      adjustmentType: 'INCREASING' as const,
    });
  }, { isolationLevel: 'Serializable' });
}

export async function issueHospitalityCommercialAmendmentIncreasingAdjustmentNote(input: {
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
  await requireAdjustmentManageAccess(input);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(async (transaction) => {
        const existing = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
          where: {
            organizationId: input.organizationId,
            commercialAmendmentId: input.commercialAmendmentId,
          },
        });
        if (existing) {
          const snapshot = validatePersistedIncreasingAdjustmentNote(existing);
          if (
            snapshot.bookingId !== input.bookingId
            || snapshot.sourceInvoiceDocumentNumber !== sourceInvoiceDocumentNumber
            || snapshot.commercialAmendmentId !== input.commercialAmendmentId
          ) {
            throw new HospitalityCommercialAmendmentIncreasingAdjustmentNoteConflictError(
              'Commercial amendment is already bound to a different adjustment note.',
            );
          }
          return existing;
        }

        const evidence = await loadAssessmentEvidence(transaction, {
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          sourceInvoiceDocumentNumber,
          commercialAmendmentId: input.commercialAmendmentId,
        });
        if (!evidence.readiness.contentReady) {
          throw new HospitalityCommercialAmendmentIncreasingAdjustmentNoteConflictError(
            firstReadinessFailure(evidence.readiness),
          );
        }
        if (!evidence.amendment.appliedAt) {
          throw new HospitalityCommercialAmendmentIncreasingAdjustmentNoteConflictError(
            'Commercial amendment is not applied.',
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
        const issuedAt = new Date();
        if (evidence.amendment.appliedAt.getTime() > issuedAt.getTime()) {
          throw new HospitalityCommercialAmendmentIncreasingAdjustmentNoteConflictError(
            'Commercial amendment applied timestamp cannot be in the future.',
          );
        }

        const snapshot = createHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot({
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          sourceInvoiceId: evidence.sourceInvoice.id,
          sourceInvoiceDocumentNumber,
          sourceInvoiceIssuedAt: evidence.sourceInvoice.issuedAt,
          commercialAmendmentId: evidence.amendment.id,
          commercialAmendmentAppliedAt: evidence.amendment.appliedAt,
          targetPricingEvidenceId: evidence.target.id,
          sourceAdjustmentOrdinal: 1,
          documentNumber,
          sequenceValue,
          issuedAt,
          currency: evidence.sourceInvoice.currency,
          beforeTaxMinor: evidence.amendment.beforeTaxTotalMinor,
          beforeTotalMinor: evidence.amendment.beforeTotalMinor,
          afterTaxMinor: evidence.amendment.afterTaxTotalMinor,
          afterTotalMinor: evidence.amendment.afterTotalMinor,
          sourceInvoiceFingerprint: evidence.sourceInvoice.documentFingerprint,
          beforePricingFingerprint: evidence.amendment.beforePricingFingerprint,
          afterPricingFingerprint: evidence.amendment.afterPricingFingerprint,
          issuerFingerprint: evidence.sourceInvoice.issuerFingerprint,
          recipientFingerprint: evidence.sourceInvoice.recipientFingerprint,
          issuer: evidence.source.snapshot.issuer,
          recipient: evidence.source.snapshot.recipient,
          supplierAbn: evidence.source.snapshot.australianTax.supplierAbn,
        });
        const documentFingerprint = hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint(snapshot);
        const created = await transaction.hospitalityIssuedAdjustmentNote.create({
          data: {
            organizationId: input.organizationId,
            bookingId: input.bookingId,
            sourceInvoiceId: evidence.sourceInvoice.id,
            refundTransactionId: null,
            commercialAmendmentId: evidence.amendment.id,
            targetPricingEvidenceId: evidence.target.id,
            predecessorAdjustmentNoteId: null,
            predecessorSourceAdjustmentOrdinal: null,
            sourceAdjustmentOrdinal: 1,
            jurisdictionCode: 'AU',
            documentType: 'ADJUSTMENT_NOTE',
            documentNumber,
            sequenceValue,
            issuedByUserId: input.actorUserId,
            issuedAt,
            currency: evidence.sourceInvoice.currency,
            adjustmentType: 'INCREASING',
            adjustmentReason: 'COMMERCIAL_AMENDMENT',
            decreaseSubtotalMinor: 0n,
            decreaseTaxMinor: 0n,
            decreaseTotalMinor: 0n,
            increaseSubtotalMinor: BigInt(snapshot.increaseSubtotalMinor),
            increaseTaxMinor: BigInt(snapshot.increaseTaxMinor),
            increaseTotalMinor: BigInt(snapshot.increaseTotalMinor),
            sourceInvoiceFingerprint: evidence.sourceInvoice.documentFingerprint,
            issuerFingerprint: evidence.sourceInvoice.issuerFingerprint,
            recipientFingerprint: evidence.sourceInvoice.recipientFingerprint,
            documentFingerprint,
            documentSnapshot: toJsonInput(snapshot),
          },
        });
        validatePersistedIncreasingAdjustmentNote(created);

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
              commercialAmendmentId: evidence.amendment.id,
              targetPricingEvidenceId: evidence.target.id,
              documentNumber,
              adjustmentType: 'INCREASING',
              adjustmentReason: 'COMMERCIAL_AMENDMENT',
              currency: evidence.sourceInvoice.currency,
              increaseTotalMinor: snapshot.increaseTotalMinor,
              documentFingerprint,
            },
          },
        });
        return created;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNoteConflictError) throw error;
      if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNoteUnavailableError) throw error;
      if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError) throw error;
      if (!isRetryableWrite(error)) throw error;
      if (attempt === 2) throw new HospitalityCommercialAmendmentIncreasingAdjustmentNoteWriteConflictError();
    }
  }
  throw new HospitalityCommercialAmendmentIncreasingAdjustmentNoteWriteConflictError();
}
