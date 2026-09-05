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
  assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness,
  type AustralianCommercialAmendmentIncreasingAdjustmentPrice,
} from './hospitality-commercial-amendment-increasing-adjustment-domain.ts';
import {
  HospitalityCommercialAmendmentAdjustmentNoteConflictError,
  HospitalityCommercialAmendmentAdjustmentNotePersistenceError,
  HospitalityCommercialAmendmentAdjustmentNoteUnavailableError,
} from './hospitality-commercial-amendment-adjustment-note-service.ts';

const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;

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

function targetPrice(row: {
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

function mapChainError(error: unknown): never {
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

async function loadAvailabilityVerifiedChain(
  input: Parameters<typeof loadVerifiedHospitalityCommercialAmendmentAdjustmentChain>[0],
) {
  try {
    return await loadVerifiedHospitalityCommercialAmendmentAdjustmentChain(input);
  } catch (error) {
    mapChainError(error);
  }
}

function firstReadinessFailure(
  readiness: ReturnType<typeof assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness>,
) {
  return readiness.requirements[0]?.message
    ?? 'Repeated increasing commercial-amendment adjustment evidence is not ready.';
}

export async function getHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNoteAvailability(input: {
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

    const chain = await loadAvailabilityVerifiedChain({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      sourceInvoiceId: sourceInvoice.id,
    });

    if (chain.priorAdjustmentNoteCount < 1 || !chain.head) {
      return Object.freeze({
        available: false as const,
        reason: 'Repeated increasing issuance requires a verified predecessor adjustment note.',
        latestDocumentNumber: null,
      });
    }

    const predecessor = chain.priorAdjustments[chain.priorAdjustments.length - 1];
    if (
      !predecessor
      || predecessor.adjustmentNoteId !== chain.head.adjustmentNoteId
      || predecessor.sourceAdjustmentOrdinal !== chain.head.sourceAdjustmentOrdinal
      || predecessor.documentNumber !== chain.head.documentNumber
      || predecessor.documentFingerprint !== chain.head.documentFingerprint
      || predecessor.after.pricingFingerprint.trim().toLowerCase()
        !== chain.head.afterPricingFingerprint.trim().toLowerCase()
    ) {
      throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
        'Verified adjustment-note chain head does not match its pricing authority.',
      );
    }

    const candidates = await transaction.hospitalityBookingCommercialAmendment.findMany({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        status: 'APPLIED',
        direction: { in: ['REFUND', 'ADDITIONAL_CHARGE'] },
        currency: predecessor.after.currency,
        beforeTotalMinor: predecessor.after.totalMinor,
        beforePricingFingerprint: predecessor.after.pricingFingerprint,
        appliedAt: { gte: chain.head.issuedAt },
      },
      orderBy: [{ appliedAt: 'asc' }, { id: 'asc' }],
      take: 3,
    });

    if (candidates.length === 0) {
      return Object.freeze({
        available: false as const,
        reason: 'No applied commercial amendment matches the current legal price baseline.',
        latestDocumentNumber: chain.head.documentNumber,
      });
    }
    if (candidates.length !== 1) {
      return Object.freeze({
        available: false as const,
        reason: 'Multiple applied commercial amendments compete for the current legal price baseline.',
        latestDocumentNumber: chain.head.documentNumber,
      });
    }

    const amendment = candidates[0]!;
    if (amendment.direction !== 'ADDITIONAL_CHARGE') {
      return Object.freeze({
        available: false as const,
        reason: 'The current legal price baseline does not have a unique supported increasing amendment.',
        latestDocumentNumber: chain.head.documentNumber,
      });
    }

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
    const immutableTargetPrice = targetPrice(targetRows[0]!, amendment.id);

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

    const readiness = assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness({
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
      targetPricingEvidence: immutableTargetPrice,
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
        latestDocumentNumber: chain.head.documentNumber,
      });
    }

    if (
      readiness.expectedSourceAdjustmentOrdinal !== chain.expectedSourceAdjustmentOrdinal
      || readiness.expectedSourceAdjustmentOrdinal < 2
      || readiness.predecessorAdjustmentNoteId !== chain.head.adjustmentNoteId
      || readiness.predecessorDocumentNumber !== chain.head.documentNumber
      || readiness.predecessorDocumentFingerprint !== chain.head.documentFingerprint
    ) {
      throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
        'Repeated increasing readiness does not match the verified adjustment-note chain head.',
      );
    }

    return Object.freeze({
      available: true as const,
      commercialAmendmentId: amendment.id,
      sourceAdjustmentOrdinal: readiness.expectedSourceAdjustmentOrdinal,
      latestDocumentNumber: chain.head.documentNumber,
    });
  }, { isolationLevel: 'Serializable' });
}
