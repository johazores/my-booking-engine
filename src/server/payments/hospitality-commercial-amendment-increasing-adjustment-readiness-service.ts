import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import {
  parseHospitalityBookingPricingEvidenceBreakdown,
} from '../bookings/booking-pricing-evidence-domain.ts';
import {
  deriveHospitalityCommercialAmendmentSettlementState,
} from '../bookings/booking-commercial-amendment-settlement-domain.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness,
  type AustralianCommercialAmendmentIncreasingAdjustmentPrice,
} from './hospitality-commercial-amendment-increasing-adjustment-domain.ts';
import {
  createHospitalityIssuedTaxInvoiceDocument,
} from './hospitality-issued-invoice-document-domain.ts';
import {
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';

const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;

export class HospitalityCommercialAmendmentIncreasingAdjustmentReadinessUnavailableError extends Error {
  constructor(message = 'Increasing commercial-amendment adjustment readiness is not available.') {
    super(message);
    this.name = 'HospitalityCommercialAmendmentIncreasingAdjustmentReadinessUnavailableError';
  }
}

export class HospitalityCommercialAmendmentIncreasingAdjustmentReadinessPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityCommercialAmendmentIncreasingAdjustmentReadinessPersistenceError';
  }
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
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadinessUnavailableError();
  }
  return normalized;
}

function validateSourceInvoice(row: {
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
      throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadinessPersistenceError(
        'Source tax invoice failed immutable evidence validation.',
      );
    }

    return Object.freeze({
      issuedAt: row.issuedAt,
      currency: row.currency,
      accommodationSubtotalMinor: row.accommodationSubtotalMinor,
      taxTotalMinor: row.taxTotalMinor,
      feeTotalMinor: row.feeTotalMinor,
      addonTotalMinor: row.addonTotalMinor,
      totalMinor: row.totalMinor,
      pricingFingerprint: row.pricingFingerprint,
    });
  } catch (error) {
    if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentReadinessPersistenceError) throw error;
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadinessPersistenceError(
      error instanceof Error ? error.message : 'Source tax invoice evidence is invalid.',
    );
  }
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
}, amendmentId: string): AustralianCommercialAmendmentIncreasingAdjustmentPrice {
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
      throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadinessPersistenceError(
        'Commercial-amendment target pricing evidence failed immutable validation.',
      );
    }

    return Object.freeze({
      currency: row.currency,
      accommodationSubtotalMinor: row.accommodationSubtotalMinor,
      taxTotalMinor: row.taxTotalMinor,
      feeTotalMinor: row.feeTotalMinor,
      addonTotalMinor: row.addonTotalMinor,
      totalMinor: row.totalMinor,
      pricingFingerprint: row.pricingFingerprint,
    });
  } catch (error) {
    if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentReadinessPersistenceError) throw error;
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadinessPersistenceError(
      error instanceof Error ? error.message : 'Commercial-amendment target pricing evidence is invalid.',
    );
  }
}

function amendmentPrice(row: {
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

export async function assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness(input: {
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
    if (!sourceInvoice) throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadinessUnavailableError();
    const sourcePrice = validateSourceInvoice(sourceInvoice);

    const amendment = await transaction.hospitalityBookingCommercialAmendment.findFirst({
      where: {
        id: input.commercialAmendmentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
      },
    });
    if (!amendment) throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadinessUnavailableError();

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
      throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadinessPersistenceError(
        'Commercial amendment must have exactly one immutable target pricing-evidence record.',
      );
    }
    const targetPrice = validateTargetPricingEvidence(targetEvidenceRows[0]!, amendment.id);

    const [priorAdjustmentNoteCount, transactions] = await Promise.all([
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
    ]);

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

    return assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness({
      sourceInvoice: sourcePrice,
      amendment: {
        status: amendment.status,
        direction: amendment.direction,
        appliedAt: amendment.appliedAt,
        deltaMinor: amendment.deltaMinor,
        before: amendmentPrice({
          currency: amendment.currency,
          accommodationSubtotalMinor: amendment.beforeAccommodationSubtotalMinor,
          taxTotalMinor: amendment.beforeTaxTotalMinor,
          feeTotalMinor: amendment.beforeFeeTotalMinor,
          addonTotalMinor: amendment.beforeAddonTotalMinor,
          totalMinor: amendment.beforeTotalMinor,
          pricingFingerprint: amendment.beforePricingFingerprint,
        }),
        after: amendmentPrice({
          currency: amendment.currency,
          accommodationSubtotalMinor: amendment.afterAccommodationSubtotalMinor,
          taxTotalMinor: amendment.afterTaxTotalMinor,
          feeTotalMinor: amendment.afterFeeTotalMinor,
          addonTotalMinor: amendment.afterAddonTotalMinor,
          totalMinor: amendment.afterTotalMinor,
          pricingFingerprint: amendment.afterPricingFingerprint,
        }),
      },
      targetPricingEvidence: targetPrice,
      priorAdjustmentNoteCount,
      settlement: {
        state: settlement.state,
        settledAdjustmentMinor: settlement.state === 'CONFLICT' ? 0n : settlement.settledAdjustmentMinor,
        remainingAdjustmentMinor: settlement.state === 'CONFLICT' ? 0n : settlement.remainingAdjustmentMinor,
        netSettledMinor: settlement.state === 'CONFLICT' ? 0n : settlement.netSettledMinor,
      },
    });
  }, { isolationLevel: 'Serializable' });
}
