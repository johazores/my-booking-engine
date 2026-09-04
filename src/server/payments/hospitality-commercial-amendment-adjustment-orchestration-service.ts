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
} from './hospitality-commercial-amendment-adjustment-chain-service.ts';
import {
  assessAustralianCommercialAmendmentAdjustmentReadiness,
  type AustralianCommercialAmendmentAdjustmentPrice,
} from './hospitality-commercial-amendment-adjustment-domain.ts';
import {
  HospitalityCommercialAmendmentAdjustmentNoteConflictError,
  HospitalityCommercialAmendmentAdjustmentNotePersistenceError,
  HospitalityCommercialAmendmentAdjustmentNoteUnavailableError,
  issueHospitalityCommercialAmendmentAdjustmentNote,
} from './hospitality-commercial-amendment-adjustment-note-service.ts';
import {
  issueHospitalityRepeatedCommercialAmendmentAdjustmentNote,
} from './hospitality-repeated-commercial-amendment-adjustment-note-service.ts';

const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;

type AvailabilityInput = Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  sourceInvoiceDocumentNumber: string;
}>;

type IssueInput = AvailabilityInput & Readonly<{
  commercialAmendmentId: string;
}>;

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

function validateTargetPricingEvidence(row: {
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
    return price(row);
  } catch (error) {
    if (error instanceof HospitalityCommercialAmendmentAdjustmentNotePersistenceError) throw error;
    throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
      error instanceof Error ? error.message : 'Commercial-amendment target pricing evidence is invalid.',
    );
  }
}

async function requireAdjustmentManageAccess(input: { organizationId: string; actorUserId: string }) {
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });
}

async function verifiedCommercialChain(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
}) {
  try {
    return await loadVerifiedHospitalityCommercialAmendmentAdjustmentChain(input);
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

function firstReadinessFailure(readiness: ReturnType<typeof assessAustralianCommercialAmendmentAdjustmentReadiness>) {
  return readiness.requirements[0]?.message ?? 'Commercial-amendment adjustment evidence is not ready.';
}

export async function getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability(input: AvailabilityInput) {
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
    if (!sourceInvoice) throw new HospitalityCommercialAmendmentAdjustmentNoteUnavailableError();

    const nonCommercialAdjustment = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        sourceInvoiceId: sourceInvoice.id,
        adjustmentReason: { not: 'COMMERCIAL_AMENDMENT' },
      },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (nonCommercialAdjustment) {
      return Object.freeze({
        available: false as const,
        reason: 'A different legal adjustment already exists for this tax invoice.',
      });
    }

    const chain = await verifiedCommercialChain({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      sourceInvoiceId: sourceInvoice.id,
    });
    const legalBaseline = chain.priorAdjustments.length > 0
      ? chain.priorAdjustments[chain.priorAdjustments.length - 1]!.after
      : price(sourceInvoice);
    const baselineIssuedAt = chain.head?.issuedAt ?? sourceInvoice.issuedAt;

    const candidates = await transaction.hospitalityBookingCommercialAmendment.findMany({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        status: 'APPLIED',
        direction: 'REFUND',
        currency: legalBaseline.currency,
        beforeTotalMinor: legalBaseline.totalMinor,
        beforePricingFingerprint: legalBaseline.pricingFingerprint,
        appliedAt: { gte: baselineIssuedAt },
      },
      orderBy: [{ appliedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 2,
    });
    const latestDocumentNumber = chain.head?.documentNumber ?? null;
    if (candidates.length === 0) {
      return Object.freeze({
        available: false as const,
        reason: 'No applied decreasing commercial amendment matches the current verified legal price baseline.',
        latestDocumentNumber,
      });
    }
    if (candidates.length > 1) {
      return Object.freeze({
        available: false as const,
        reason: 'Multiple commercial amendments match the current verified legal price baseline; adjustment authority is ambiguous.',
        latestDocumentNumber,
      });
    }
    const amendment = candidates[0]!;

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
    const targetPricingEvidence = validateTargetPricingEvidence(targetRows[0]!, amendment.id);

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
      targetPricingEvidence,
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
      return Object.freeze({
        available: false as const,
        reason: firstReadinessFailure(readiness),
        latestDocumentNumber,
      });
    }
    const sourceAdjustmentOrdinal = readiness.expectedSourceAdjustmentOrdinal;
    if (
      sourceAdjustmentOrdinal === null
      || sourceAdjustmentOrdinal !== chain.expectedSourceAdjustmentOrdinal
      || (chain.head === null && (
        readiness.predecessorAdjustmentNoteId !== null
        || readiness.predecessorDocumentNumber !== null
        || readiness.predecessorDocumentFingerprint !== null
      ))
      || (chain.head !== null && (
        readiness.predecessorAdjustmentNoteId !== chain.head.adjustmentNoteId
        || readiness.predecessorDocumentNumber !== chain.head.documentNumber
        || readiness.predecessorDocumentFingerprint !== chain.head.documentFingerprint
      ))
    ) {
      throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
        'Commercial-amendment readiness no longer matches the verified legal-document chain.',
      );
    }

    return Object.freeze({
      available: true as const,
      commercialAmendmentId: amendment.id,
      sourceAdjustmentOrdinal,
      latestDocumentNumber,
    });
  }, { isolationLevel: 'Serializable' });
}

async function existingIssuedAmendmentMode(input: IssueInput, sourceInvoiceDocumentNumber: string) {
  return db.$transaction(async (transaction) => {
    const existing = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
      where: {
        organizationId: input.organizationId,
        commercialAmendmentId: input.commercialAmendmentId,
      },
    });
    if (!existing) return null;
    if (existing.bookingId !== input.bookingId || existing.adjustmentReason !== 'COMMERCIAL_AMENDMENT') {
      throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(
        'Commercial amendment is already bound to a different adjustment note.',
      );
    }

    const sourceInvoice = await transaction.hospitalityIssuedInvoice.findFirst({
      where: {
        id: existing.sourceInvoiceId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        jurisdictionCode: 'AU',
        documentType: 'TAX_INVOICE',
        documentNumber: sourceInvoiceDocumentNumber,
      },
      select: { id: true },
    });
    if (!sourceInvoice) {
      throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(
        'Commercial amendment is already bound to a different source tax invoice.',
      );
    }

    const chain = await verifiedCommercialChain({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      sourceInvoiceId: sourceInvoice.id,
    });
    if (!chain.priorAdjustments.some((entry) => entry.adjustmentNoteId === existing.id)) {
      throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
        'Issued commercial-amendment adjustment note is not present in its verified source chain.',
      );
    }
    return existing.sourceAdjustmentOrdinal === 1 ? 'FIRST' as const : 'REPEATED' as const;
  }, { isolationLevel: 'Serializable' });
}

export async function issueHospitalityNextCommercialAmendmentAdjustmentNote(input: IssueInput) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.commercialAmendmentId, 'commercialAmendmentId');
  const sourceInvoiceDocumentNumber = normalizeSourceInvoiceNumber(input.sourceInvoiceDocumentNumber);
  await requireAdjustmentManageAccess(input);

  const existingMode = await existingIssuedAmendmentMode(input, sourceInvoiceDocumentNumber);
  if (existingMode === 'FIRST') {
    return issueHospitalityCommercialAmendmentAdjustmentNote({ ...input, sourceInvoiceDocumentNumber });
  }
  if (existingMode === 'REPEATED') {
    return issueHospitalityRepeatedCommercialAmendmentAdjustmentNote({ ...input, sourceInvoiceDocumentNumber });
  }

  const availability = await getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    bookingId: input.bookingId,
    sourceInvoiceDocumentNumber,
  });
  if (!availability.available) {
    throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(availability.reason);
  }
  if (availability.commercialAmendmentId !== input.commercialAmendmentId) {
    throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(
      'The requested commercial amendment is not the unique next legal adjustment for this tax invoice.',
    );
  }

  if (availability.sourceAdjustmentOrdinal === 1) {
    return issueHospitalityCommercialAmendmentAdjustmentNote({ ...input, sourceInvoiceDocumentNumber });
  }
  return issueHospitalityRepeatedCommercialAmendmentAdjustmentNote({ ...input, sourceInvoiceDocumentNumber });
}
