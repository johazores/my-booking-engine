import type { Prisma } from '../../generated/prisma/client.ts';
import {
  deriveHospitalityCommercialAmendmentSettlementState,
} from '../bookings/booking-commercial-amendment-settlement-domain.ts';
import {
  parseHospitalityBookingPricingEvidenceBreakdown,
} from '../bookings/booking-pricing-evidence-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  validateHospitalityCommercialAmendmentAdjustmentChain,
  type HospitalityCommercialAmendmentAdjustmentChainEntry,
  type HospitalityCommercialAmendmentAdjustmentChainSourceInvoice,
} from './hospitality-commercial-amendment-adjustment-chain-domain.ts';
import type { AustralianCommercialAmendmentAdjustmentPrice } from './hospitality-commercial-amendment-adjustment-domain.ts';
import {
  hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-adjustment-note-domain.ts';
import {
  hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-increasing-adjustment-note-domain.ts';
import { createHospitalityIssuedTaxInvoiceDocument } from './hospitality-issued-invoice-document-domain.ts';
import {
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';

export const HOSPITALITY_COMMERCIAL_AMENDMENT_ADJUSTMENT_CHAIN_LIMIT = 5_000;

export class HospitalityCommercialAmendmentAdjustmentChainUnavailableError extends Error {
  constructor(message = 'Commercial-amendment adjustment-note chain is not available.') {
    super(message);
    this.name = 'HospitalityCommercialAmendmentAdjustmentChainUnavailableError';
  }
}

export class HospitalityCommercialAmendmentAdjustmentChainLimitError extends Error {
  constructor() {
    super(`Commercial-amendment adjustment-note chain cannot exceed ${HOSPITALITY_COMMERCIAL_AMENDMENT_ADJUSTMENT_CHAIN_LIMIT} documents.`);
    this.name = 'HospitalityCommercialAmendmentAdjustmentChainLimitError';
  }
}

function price(input: {
  currency: string;
  accommodationSubtotalMinor: bigint;
  taxTotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  totalMinor: bigint;
  pricingFingerprint: string;
}): AustralianCommercialAmendmentAdjustmentPrice {
  return Object.freeze({
    currency: input.currency,
    accommodationSubtotalMinor: input.accommodationSubtotalMinor,
    taxTotalMinor: input.taxTotalMinor,
    feeTotalMinor: input.feeTotalMinor,
    addonTotalMinor: input.addonTotalMinor,
    totalMinor: input.totalMinor,
    pricingFingerprint: input.pricingFingerprint,
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
}): HospitalityCommercialAmendmentAdjustmentChainSourceInvoice {
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
      throw new Error('Source tax invoice failed immutable evidence validation.');
    }

    return Object.freeze({
      id: row.id,
      organizationId: row.organizationId,
      bookingId: row.bookingId,
      documentNumber: row.documentNumber,
      issuedAt: row.issuedAt,
      documentFingerprint: row.documentFingerprint,
      issuerFingerprint: row.issuerFingerprint,
      recipientFingerprint: row.recipientFingerprint,
      price: price(row),
    });
  } catch (error) {
    throw new HospitalityCommercialAmendmentAdjustmentChainUnavailableError(
      error instanceof Error ? error.message : 'Source tax invoice is invalid.',
    );
  }
}

function parsedTargetPrice(row: {
  currency: string;
  accommodationSubtotalMinor: bigint;
  taxTotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  totalMinor: bigint;
  pricingFingerprint: string;
  pricingBreakdown: Prisma.JsonValue;
}) {
  try {
    const breakdown = parseHospitalityBookingPricingEvidenceBreakdown(row.pricingBreakdown);
    return Object.freeze({
      currency: breakdown.currency,
      accommodationSubtotalMinor: BigInt(breakdown.accommodationSubtotalMinor),
      taxTotalMinor: BigInt(breakdown.taxTotalMinor),
      feeTotalMinor: BigInt(breakdown.feeTotalMinor),
      addonTotalMinor: BigInt(breakdown.addonTotalMinor),
      totalMinor: BigInt(breakdown.totalMinor),
      pricingFingerprint: breakdown.pricingFingerprint,
    });
  } catch (error) {
    throw new HospitalityCommercialAmendmentAdjustmentChainUnavailableError(
      error instanceof Error ? error.message : 'Target pricing evidence is invalid.',
    );
  }
}

function chainLockKey(input: { organizationId: string; bookingId: string; sourceInvoiceId: string }) {
  return `hospitality-adjustment-chain:${input.organizationId}:${input.bookingId}:${input.sourceInvoiceId}`;
}

function parseCommercialAdjustmentSnapshot(row: {
  adjustmentType: string;
  documentSnapshot: Prisma.JsonValue;
  documentFingerprint: string;
}) {
  try {
    if (row.adjustmentType === 'DECREASING') {
      const snapshot = parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot(row.documentSnapshot);
      if (hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(snapshot) !== row.documentFingerprint) {
        throw new Error('Decreasing commercial adjustment-note fingerprint does not match immutable evidence.');
      }
      return snapshot;
    }
    if (row.adjustmentType === 'INCREASING') {
      const snapshot = parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot(row.documentSnapshot);
      if (hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint(snapshot) !== row.documentFingerprint) {
        throw new Error('Increasing commercial adjustment-note fingerprint does not match immutable evidence.');
      }
      return snapshot;
    }
    throw new Error('Commercial adjustment-note direction is unsupported.');
  } catch (error) {
    throw new HospitalityCommercialAmendmentAdjustmentChainUnavailableError(
      error instanceof Error ? error.message : 'Commercial adjustment-note snapshot is invalid.',
    );
  }
}

function settlementAuthority(
  settlement: ReturnType<typeof deriveHospitalityCommercialAmendmentSettlementState>,
) {
  if (settlement.state === 'CONFLICT') {
    return Object.freeze({
      state: settlement.state,
      settledAdjustmentMinor: 0n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 0n,
    });
  }
  return Object.freeze({
    state: settlement.state,
    settledAdjustmentMinor: settlement.settledAdjustmentMinor,
    remainingAdjustmentMinor: settlement.remainingAdjustmentMinor,
    netSettledMinor: settlement.netSettledMinor,
  });
}

export async function loadVerifiedHospitalityCommercialAmendmentAdjustmentChain(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.sourceInvoiceId, 'sourceInvoiceId');

  const sourceInvoiceRow = await input.transaction.hospitalityIssuedInvoice.findFirst({
    where: {
      id: input.sourceInvoiceId,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      jurisdictionCode: 'AU',
      documentType: 'TAX_INVOICE',
    },
  });
  if (!sourceInvoiceRow) throw new HospitalityCommercialAmendmentAdjustmentChainUnavailableError();
  const sourceInvoice = validateSourceInvoice(sourceInvoiceRow);

  const rows = await input.transaction.hospitalityIssuedAdjustmentNote.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      sourceInvoiceId: input.sourceInvoiceId,
    },
    orderBy: [{ sourceAdjustmentOrdinal: 'asc' }, { issuedAt: 'asc' }, { id: 'asc' }],
    take: HOSPITALITY_COMMERCIAL_AMENDMENT_ADJUSTMENT_CHAIN_LIMIT + 1,
  });
  if (rows.length > HOSPITALITY_COMMERCIAL_AMENDMENT_ADJUSTMENT_CHAIN_LIMIT) {
    throw new HospitalityCommercialAmendmentAdjustmentChainLimitError();
  }
  if (rows.some((row) => row.adjustmentReason !== 'COMMERCIAL_AMENDMENT')) {
    throw new HospitalityCommercialAmendmentAdjustmentChainUnavailableError(
      'A non-commercial legal adjustment already exists for the source tax invoice.',
    );
  }

  const amendmentIds = rows.map((row) => row.commercialAmendmentId).filter((value): value is string => value !== null);
  const targetEvidenceIds = rows.map((row) => row.targetPricingEvidenceId).filter((value): value is string => value !== null);
  if (amendmentIds.length !== rows.length || targetEvidenceIds.length !== rows.length) {
    throw new HospitalityCommercialAmendmentAdjustmentChainUnavailableError(
      'Commercial adjustment-note authority is incomplete.',
    );
  }

  const [amendments, targetRows, paymentTransactions] = await Promise.all([
    amendmentIds.length
      ? input.transaction.hospitalityBookingCommercialAmendment.findMany({
          where: {
            id: { in: amendmentIds },
            organizationId: input.organizationId,
            bookingId: input.bookingId,
          },
        })
      : [],
    targetEvidenceIds.length
      ? input.transaction.hospitalityBookingPricingEvidence.findMany({
          where: {
            id: { in: targetEvidenceIds },
            organizationId: input.organizationId,
            bookingId: input.bookingId,
            source: 'COMMERCIAL_AMENDMENT_TARGET',
          },
        })
      : [],
    input.transaction.paymentTransaction.findMany({
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
        createdAt: true,
      },
    }),
  ]);
  const amendmentById = new Map(amendments.map((row) => [row.id, row]));
  const targetById = new Map(targetRows.map((row) => [row.id, row]));
  const chainAmendmentIds = new Set(amendmentIds);
  const baseSettlementTransactions = paymentTransactions.filter(
    (transaction) => transaction.commercialAmendmentId === null,
  );
  const progressiveCommercialAmendmentTransactions: typeof paymentTransactions = [];
  const settlementTransactionsByAmendment = new Map<string, typeof paymentTransactions>();
  for (const transaction of paymentTransactions) {
    if (!transaction.commercialAmendmentId || !chainAmendmentIds.has(transaction.commercialAmendmentId)) continue;
    const current = settlementTransactionsByAmendment.get(transaction.commercialAmendmentId) ?? [];
    current.push(transaction);
    settlementTransactionsByAmendment.set(transaction.commercialAmendmentId, current);
  }

  const entries: HospitalityCommercialAmendmentAdjustmentChainEntry[] = rows.map((row) => {
    if (!row.commercialAmendmentId || !row.targetPricingEvidenceId) {
      throw new HospitalityCommercialAmendmentAdjustmentChainUnavailableError(
        'Commercial adjustment-note authority is incomplete.',
      );
    }
    const amendment = amendmentById.get(row.commercialAmendmentId);
    const target = targetById.get(row.targetPricingEvidenceId);
    if (!amendment || !target) {
      throw new HospitalityCommercialAmendmentAdjustmentChainUnavailableError(
        'Commercial adjustment-note authority could not be reloaded inside tenant scope.',
      );
    }

    const snapshot = parseCommercialAdjustmentSnapshot(row);
    progressiveCommercialAmendmentTransactions.push(
      ...(settlementTransactionsByAmendment.get(amendment.id) ?? []),
    );
    const settlementTransactionsAtIssue = [
      ...baseSettlementTransactions.filter((transaction) => transaction.createdAt.getTime() <= row.issuedAt.getTime()),
      ...progressiveCommercialAmendmentTransactions.filter(
        (transaction) => transaction.createdAt.getTime() <= row.issuedAt.getTime(),
      ),
    ];
    const settlement = deriveHospitalityCommercialAmendmentSettlementState({
      amendmentId: amendment.id,
      direction: amendment.direction,
      paymentProviderCode: amendment.paymentProviderCode,
      currency: amendment.currency,
      beforeTotalMinor: amendment.beforeTotalMinor,
      afterTotalMinor: amendment.afterTotalMinor,
      deltaMinor: amendment.deltaMinor,
      transactions: settlementTransactionsAtIssue,
    });

    return Object.freeze({
      ...row,
      snapshot,
      amendment: Object.freeze({
        id: amendment.id,
        organizationId: amendment.organizationId,
        bookingId: amendment.bookingId,
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
      }),
      targetPricingEvidence: Object.freeze({
        id: target.id,
        organizationId: target.organizationId,
        bookingId: target.bookingId,
        commercialAmendmentId: target.commercialAmendmentId,
        source: target.source,
        price: price(target),
        parsedPrice: parsedTargetPrice(target),
      }),
      settlement: settlementAuthority(settlement),
    });
  });

  return validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries });
}

export async function selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.sourceInvoiceId, 'sourceInvoiceId');

  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chainLockKey(input)}, 0))`;
  return loadVerifiedHospitalityCommercialAmendmentAdjustmentChain(input);
}
