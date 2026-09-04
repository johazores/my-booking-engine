import type { Prisma } from '../../generated/prisma/client.ts';
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
  hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-increasing-adjustment-note-domain.ts';
import {
  createHospitalityIssuedTaxInvoiceDocument,
} from './hospitality-issued-invoice-document-domain.ts';
import {
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';

export const HOSPITALITY_INCREASING_ADJUSTMENT_READ_BATCH_LIMIT = 100;

export class HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError extends Error {
  constructor(message = 'Increasing commercial-amendment adjustment-note authority failed integrity validation.') {
    super(message);
    this.name = 'HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError';
  }
}

export class HospitalityCommercialAmendmentIncreasingAdjustmentReadLimitError extends Error {
  constructor() {
    super(`Increasing adjustment-note read verification cannot exceed ${HOSPITALITY_INCREASING_ADJUSTMENT_READ_BATCH_LIMIT} rows per batch.`);
    this.name = 'HospitalityCommercialAmendmentIncreasingAdjustmentReadLimitError';
  }
}

type IncreasingAdjustmentReference = Readonly<{
  id: string;
  bookingId: string;
  sourceInvoiceId: string;
}>;

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
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError(
      'Increasing adjustment-note source tax invoice failed immutable validation.',
    );
  }
  return Object.freeze({ row, snapshot, price: Object.freeze({ ...price(row), issuedAt: row.issuedAt }) });
}

function validateTargetPricingEvidence(row: {
  id: string;
  organizationId: string;
  bookingId: string;
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
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError(
      'Increasing adjustment-note target pricing evidence failed immutable validation.',
    );
  }
  return price(row);
}

function validatePersistedRow(row: {
  id: string;
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
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError(
      'Persisted increasing adjustment note failed material-column validation.',
    );
  }
  return Object.freeze({ row, snapshot });
}

export async function verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows(input: {
  organizationId: string;
  rows: readonly IncreasingAdjustmentReference[];
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  if (input.rows.length > HOSPITALITY_INCREASING_ADJUSTMENT_READ_BATCH_LIMIT) {
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadLimitError();
  }
  if (input.rows.length === 0) return Object.freeze([]);

  const uniqueIds = new Set<string>();
  for (const row of input.rows) {
    assertUuidIdentifier(row.id, 'adjustmentNoteId');
    assertUuidIdentifier(row.bookingId, 'bookingId');
    assertUuidIdentifier(row.sourceInvoiceId, 'sourceInvoiceId');
    if (uniqueIds.has(row.id)) {
      throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError(
        'Increasing adjustment-note verification references must be unique.',
      );
    }
    uniqueIds.add(row.id);
  }

  try {
    const persistedRows = await db.hospitalityIssuedAdjustmentNote.findMany({
      where: {
        id: { in: [...uniqueIds] },
        organizationId: input.organizationId,
        jurisdictionCode: 'AU',
        documentType: 'ADJUSTMENT_NOTE',
        adjustmentType: 'INCREASING',
        adjustmentReason: 'COMMERCIAL_AMENDMENT',
      },
    });
    if (persistedRows.length !== input.rows.length) {
      throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError();
    }
    const validatedRows = persistedRows.map(validatePersistedRow);
    const requestedById = new Map(input.rows.map((row) => [row.id, row]));
    for (const item of validatedRows) {
      const requested = requestedById.get(item.row.id);
      if (!requested || requested.bookingId !== item.row.bookingId || requested.sourceInvoiceId !== item.row.sourceInvoiceId) {
        throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError(
          'Increasing adjustment-note tenant/resource scope changed during verification.',
        );
      }
    }

    const sourceInvoiceIds = [...new Set(validatedRows.map((item) => item.row.sourceInvoiceId))];
    const amendmentIds = [...new Set(validatedRows.map((item) => item.row.commercialAmendmentId!))];
    const bookingIds = [...new Set(validatedRows.map((item) => item.row.bookingId))];

    const [sourceInvoices, amendments, targets, transactions, sourceAdjustmentRows] = await Promise.all([
      db.hospitalityIssuedInvoice.findMany({
        where: {
          id: { in: sourceInvoiceIds },
          organizationId: input.organizationId,
          jurisdictionCode: 'AU',
          documentType: 'TAX_INVOICE',
        },
      }),
      db.hospitalityBookingCommercialAmendment.findMany({
        where: {
          organizationId: input.organizationId,
          bookingId: { in: bookingIds },
          status: 'APPLIED',
          direction: { in: ['REFUND', 'ADDITIONAL_CHARGE'] },
        },
      }),
      db.hospitalityBookingPricingEvidence.findMany({
        where: {
          organizationId: input.organizationId,
          commercialAmendmentId: { in: amendmentIds },
          source: 'COMMERCIAL_AMENDMENT_TARGET',
        },
      }),
      db.paymentTransaction.findMany({
        where: { organizationId: input.organizationId, bookingId: { in: bookingIds } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          bookingId: true,
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
      db.hospitalityIssuedAdjustmentNote.findMany({
        where: { organizationId: input.organizationId, sourceInvoiceId: { in: sourceInvoiceIds } },
        select: { id: true, sourceInvoiceId: true },
      }),
    ]);

    const sourceById = new Map(sourceInvoices.map((row) => [row.id, validateSourceInvoice(row)]));
    const amendmentById = new Map(amendments.map((row) => [row.id, row]));
    const targetsByAmendment = new Map<string, typeof targets>();
    for (const target of targets) {
      if (!target.commercialAmendmentId) continue;
      const list = targetsByAmendment.get(target.commercialAmendmentId) ?? [];
      list.push(target);
      targetsByAmendment.set(target.commercialAmendmentId, list);
    }
    const transactionsByBooking = new Map<string, typeof transactions>();
    for (const transaction of transactions) {
      const list = transactionsByBooking.get(transaction.bookingId) ?? [];
      list.push(transaction);
      transactionsByBooking.set(transaction.bookingId, list);
    }
    const sourceAdjustments = new Map<string, string[]>();
    for (const adjustment of sourceAdjustmentRows) {
      const list = sourceAdjustments.get(adjustment.sourceInvoiceId) ?? [];
      list.push(adjustment.id);
      sourceAdjustments.set(adjustment.sourceInvoiceId, list);
    }

    for (const item of validatedRows) {
      const source = sourceById.get(item.row.sourceInvoiceId);
      const amendment = amendmentById.get(item.row.commercialAmendmentId!);
      const targetRows = targetsByAmendment.get(item.row.commercialAmendmentId!) ?? [];
      const target = targetRows.length === 1 ? targetRows[0] : undefined;
      const sourceAdjustmentIds = sourceAdjustments.get(item.row.sourceInvoiceId) ?? [];
      const baselineCompetitors = amendments.filter((candidate) => (
        candidate.bookingId === item.row.bookingId
        && candidate.currency === source?.row.currency
        && candidate.beforeTotalMinor === source?.row.totalMinor
        && candidate.beforePricingFingerprint === source?.row.pricingFingerprint
        && candidate.appliedAt !== null
        && source !== undefined
        && candidate.appliedAt.getTime() >= source.row.issuedAt.getTime()
      ));
      if (
        !source
        || !amendment
        || !target
        || target.id !== item.row.targetPricingEvidenceId
        || source.row.bookingId !== item.row.bookingId
        || amendment.bookingId !== item.row.bookingId
        || target.bookingId !== item.row.bookingId
        || sourceAdjustmentIds.length !== 1
        || sourceAdjustmentIds[0] !== item.row.id
        || baselineCompetitors.length !== 1
        || baselineCompetitors[0]?.id !== amendment.id
      ) {
        throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError(
          'Increasing adjustment-note source authority is incomplete or ambiguous.',
        );
      }

      const targetPrice = validateTargetPricingEvidence(target, amendment.id);
      const settlement = deriveHospitalityCommercialAmendmentSettlementState({
        amendmentId: amendment.id,
        direction: amendment.direction,
        paymentProviderCode: amendment.paymentProviderCode,
        currency: amendment.currency,
        beforeTotalMinor: amendment.beforeTotalMinor,
        afterTotalMinor: amendment.afterTotalMinor,
        deltaMinor: amendment.deltaMinor,
        transactions: transactionsByBooking.get(item.row.bookingId) ?? [],
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
        targetPricingEvidence: targetPrice,
        priorAdjustmentNoteCount: 0,
        settlement: {
          state: settlement.state,
          settledAdjustmentMinor: settlement.state === 'CONFLICT' ? 0n : settlement.settledAdjustmentMinor,
          remainingAdjustmentMinor: settlement.state === 'CONFLICT' ? 0n : settlement.remainingAdjustmentMinor,
          netSettledMinor: settlement.state === 'CONFLICT' ? 0n : settlement.netSettledMinor,
        },
      });

      if (
        !readiness.contentReady
        || !amendment.appliedAt
        || item.snapshot.commercialAmendmentId !== amendment.id
        || item.snapshot.commercialAmendmentAppliedAt !== amendment.appliedAt.toISOString()
        || item.snapshot.targetPricingEvidenceId !== target.id
        || item.snapshot.beforeTaxMinor !== amendment.beforeTaxTotalMinor.toString()
        || item.snapshot.beforeTotalMinor !== amendment.beforeTotalMinor.toString()
        || item.snapshot.afterTaxMinor !== amendment.afterTaxTotalMinor.toString()
        || item.snapshot.afterTotalMinor !== amendment.afterTotalMinor.toString()
        || item.snapshot.beforePricingFingerprint !== amendment.beforePricingFingerprint
        || item.snapshot.afterPricingFingerprint !== amendment.afterPricingFingerprint
        || item.snapshot.sourceInvoiceFingerprint !== source.row.documentFingerprint
        || item.snapshot.sourceInvoiceDocumentNumber !== source.row.documentNumber
        || item.snapshot.sourceInvoiceIssuedAt !== source.row.issuedAt.toISOString()
        || item.snapshot.issuerFingerprint !== source.row.issuerFingerprint
        || item.snapshot.recipientFingerprint !== source.row.recipientFingerprint
        || item.row.issuedAt.getTime() < amendment.appliedAt.getTime()
      ) {
        throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError(
          'Increasing adjustment-note commercial authority failed immutable validation.',
        );
      }
    }

    return Object.freeze(validatedRows.map((item) => Object.freeze({
      id: item.row.id,
      bookingId: item.row.bookingId,
      sourceInvoiceId: item.row.sourceInvoiceId,
      commercialAmendmentId: item.row.commercialAmendmentId!,
      targetPricingEvidenceId: item.row.targetPricingEvidenceId!,
      documentNumber: item.row.documentNumber,
      documentFingerprint: item.row.documentFingerprint,
    })));
  } catch (error) {
    if (
      error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError
      || error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentReadLimitError
    ) {
      throw error;
    }
    throw new HospitalityCommercialAmendmentIncreasingAdjustmentReadIntegrityError(
      error instanceof Error ? error.message : undefined,
    );
  }
}
