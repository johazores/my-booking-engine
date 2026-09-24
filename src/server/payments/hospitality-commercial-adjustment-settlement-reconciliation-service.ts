import {
  deriveHospitalityCommercialAmendmentSettlementState,
} from '../bookings/booking-commercial-amendment-settlement-domain.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-adjustment-note-domain.ts';
import {
  hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-increasing-adjustment-note-domain.ts';
import {
  selectVerifiedHospitalityCommercialSettlementAuthorityGroups,
  type HospitalityCommercialSettlementReconciliationAuthority as CommercialAdjustmentAuthority,
  type HospitalityCommercialSettlementReconciliationSourceInvoice as CommercialSourceInvoiceAuthority,
} from './hospitality-commercial-settlement-reconciliation-authority-domain.ts';
import { createHospitalityIssuedTaxInvoiceDocument } from './hospitality-issued-invoice-document-domain.ts';
import {
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';
import {
  findHospitalityCommercialTaxDocumentSettlementDrift,
  type HospitalityTaxDocumentCurrentCommercialSettlement,
} from './hospitality-tax-document-settlement-drift-domain.ts';
import type { HospitalityTaxDocumentReconciliationFailure } from './hospitality-tax-document-reconciliation-domain.ts';

const COMMERCIAL_SETTLEMENT_TRANSACTION_LIMIT = 50_000;

function authorityFromRow(row: {
  bookingId: string;
  sourceInvoiceId: string;
  documentNumber: string;
  sourceAdjustmentOrdinal: number;
  issuedAt: Date;
  currency: string;
  adjustmentType: string;
  commercialAmendmentId: string | null;
  targetPricingEvidenceId: string | null;
  documentFingerprint: string;
  documentSnapshot: unknown;
}, organizationId: string): CommercialAdjustmentAuthority | null {
  if (!row.commercialAmendmentId) return null;
  try {
    if (row.adjustmentType === 'DECREASING') {
      const snapshot = parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot(row.documentSnapshot);
      if (
        snapshot.organizationId !== organizationId
        || snapshot.bookingId !== row.bookingId
        || snapshot.sourceInvoiceId !== row.sourceInvoiceId
        || snapshot.documentNumber !== row.documentNumber
        || Number(snapshot.sourceAdjustmentOrdinal) !== row.sourceAdjustmentOrdinal
        || new Date(snapshot.issuedAt).getTime() !== row.issuedAt.getTime()
        || snapshot.commercialAmendmentId !== row.commercialAmendmentId
        || snapshot.targetPricingEvidenceId !== row.targetPricingEvidenceId
        || snapshot.currency !== row.currency
        || hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(snapshot) !== row.documentFingerprint
      ) return null;
      return Object.freeze({
        documentNumber: row.documentNumber,
        bookingId: row.bookingId,
        sourceInvoiceId: row.sourceInvoiceId,
        sourceInvoiceDocumentNumber: snapshot.sourceInvoiceDocumentNumber,
        sourceInvoiceIssuedAt: new Date(snapshot.sourceInvoiceIssuedAt),
        sourceInvoiceFingerprint: snapshot.sourceInvoiceFingerprint,
        issuerFingerprint: snapshot.issuerFingerprint,
        recipientFingerprint: snapshot.recipientFingerprint,
        sourceAdjustmentOrdinal: row.sourceAdjustmentOrdinal,
        issuedAt: row.issuedAt,
        commercialAmendmentId: row.commercialAmendmentId,
        commercialAmendmentAppliedAt: new Date(snapshot.commercialAmendmentAppliedAt),
        targetPricingEvidenceId: snapshot.targetPricingEvidenceId,
        beforePricingFingerprint: snapshot.beforePricingFingerprint,
        afterPricingFingerprint: snapshot.afterPricingFingerprint,
        adjustmentType: 'DECREASING' as const,
        currency: row.currency,
        beforeTotalMinor: BigInt(snapshot.beforeTotalMinor),
        afterTotalMinor: BigInt(snapshot.afterTotalMinor),
      });
    }
    if (row.adjustmentType === 'INCREASING') {
      const snapshot = parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot(row.documentSnapshot);
      if (
        snapshot.organizationId !== organizationId
        || snapshot.bookingId !== row.bookingId
        || snapshot.sourceInvoiceId !== row.sourceInvoiceId
        || snapshot.documentNumber !== row.documentNumber
        || Number(snapshot.sourceAdjustmentOrdinal) !== row.sourceAdjustmentOrdinal
        || new Date(snapshot.issuedAt).getTime() !== row.issuedAt.getTime()
        || snapshot.commercialAmendmentId !== row.commercialAmendmentId
        || snapshot.targetPricingEvidenceId !== row.targetPricingEvidenceId
        || snapshot.currency !== row.currency
        || hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint(snapshot) !== row.documentFingerprint
      ) return null;
      return Object.freeze({
        documentNumber: row.documentNumber,
        bookingId: row.bookingId,
        sourceInvoiceId: row.sourceInvoiceId,
        sourceInvoiceDocumentNumber: snapshot.sourceInvoiceDocumentNumber,
        sourceInvoiceIssuedAt: new Date(snapshot.sourceInvoiceIssuedAt),
        sourceInvoiceFingerprint: snapshot.sourceInvoiceFingerprint,
        issuerFingerprint: snapshot.issuerFingerprint,
        recipientFingerprint: snapshot.recipientFingerprint,
        sourceAdjustmentOrdinal: row.sourceAdjustmentOrdinal,
        issuedAt: row.issuedAt,
        commercialAmendmentId: row.commercialAmendmentId,
        commercialAmendmentAppliedAt: new Date(snapshot.commercialAmendmentAppliedAt),
        targetPricingEvidenceId: snapshot.targetPricingEvidenceId,
        beforePricingFingerprint: snapshot.beforePricingFingerprint,
        afterPricingFingerprint: snapshot.afterPricingFingerprint,
        adjustmentType: 'INCREASING' as const,
        currency: row.currency,
        beforeTotalMinor: BigInt(snapshot.beforeTotalMinor),
        afterTotalMinor: BigInt(snapshot.afterTotalMinor),
      });
    }
  } catch {
    // Immutable register validation owns malformed legal evidence.
  }
  return null;
}

function sourceInvoiceAuthorityFromRow(row: {
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
  documentSnapshot: unknown;
}, organizationId: string): CommercialSourceInvoiceAuthority | null {
  try {
    const snapshot = parseHospitalityIssuedTaxInvoiceSnapshot(row.documentSnapshot);
    const document = createHospitalityIssuedTaxInvoiceDocument(snapshot);
    if (
      row.organizationId !== organizationId
      || row.jurisdictionCode !== 'AU'
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
    ) return null;

    return Object.freeze({
      id: row.id,
      bookingId: row.bookingId,
      documentNumber: row.documentNumber,
      issuedAt: row.issuedAt,
      currency: row.currency,
      totalMinor: row.totalMinor,
      pricingFingerprint: row.pricingFingerprint,
      issuerFingerprint: row.issuerFingerprint,
      recipientFingerprint: row.recipientFingerprint,
      documentFingerprint: row.documentFingerprint,
    });
  } catch {
    // Immutable register/source-link reconciliation owns invalid source-invoice evidence.
    return null;
  }
}

export async function currentHospitalityCommercialAdjustmentSettlementDriftFailures(input: {
  organizationId: string;
  documentLimit: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  if (!Number.isSafeInteger(input.documentLimit) || input.documentLimit < 1) {
    throw new RangeError('documentLimit must be a positive safe integer.');
  }

  return db.$transaction(async (transaction) => {
    const issued = await transaction.hospitalityIssuedAdjustmentNote.findMany({
      where: {
        organizationId: input.organizationId,
        jurisdictionCode: 'AU',
        documentType: 'ADJUSTMENT_NOTE',
        adjustmentReason: 'COMMERCIAL_AMENDMENT',
      },
      select: {
        bookingId: true,
        sourceInvoiceId: true,
        documentNumber: true,
        sourceAdjustmentOrdinal: true,
        issuedAt: true,
        currency: true,
        adjustmentType: true,
        commercialAmendmentId: true,
        targetPricingEvidenceId: true,
        documentFingerprint: true,
        documentSnapshot: true,
      },
      orderBy: [{ bookingId: 'asc' }, { sourceInvoiceId: 'asc' }, { sourceAdjustmentOrdinal: 'asc' }, { id: 'asc' }],
      take: input.documentLimit + 1,
    });
    if (issued.length > input.documentLimit) {
      return Object.freeze({ status: 'DOCUMENT_LIMIT_EXCEEDED' as const });
    }

    const parsedAuthorities = issued
      .map((row) => authorityFromRow(row, input.organizationId))
      .filter((authority): authority is CommercialAdjustmentAuthority => authority !== null);
    if (parsedAuthorities.length === 0) {
      return Object.freeze({ status: 'OK' as const, failures: Object.freeze([] as HospitalityTaxDocumentReconciliationFailure[]) });
    }

    const sourceInvoiceIds = [...new Set(parsedAuthorities.map((authority) => authority.sourceInvoiceId))];
    const amendmentIds = [...new Set(parsedAuthorities.map((authority) => authority.commercialAmendmentId))];
    const targetPricingEvidenceIds = [...new Set(parsedAuthorities.map((authority) => authority.targetPricingEvidenceId))];
    const [sourceInvoiceRows, amendments, targetPricingEvidence] = await Promise.all([
      transaction.hospitalityIssuedInvoice.findMany({
        where: {
          organizationId: input.organizationId,
          id: { in: sourceInvoiceIds },
          jurisdictionCode: 'AU',
          documentType: 'TAX_INVOICE',
        },
        select: {
          id: true,
          organizationId: true,
          bookingId: true,
          preparationId: true,
          pricingEvidenceId: true,
          issuerProfileId: true,
          jurisdictionCode: true,
          documentType: true,
          documentNumber: true,
          sequenceValue: true,
          issuedAt: true,
          currency: true,
          accommodationSubtotalMinor: true,
          taxTotalMinor: true,
          feeTotalMinor: true,
          addonTotalMinor: true,
          totalMinor: true,
          preparationFingerprint: true,
          pricingFingerprint: true,
          issuerFingerprint: true,
          recipientFingerprint: true,
          documentFingerprint: true,
          documentSnapshot: true,
        },
      }),
      transaction.hospitalityBookingCommercialAmendment.findMany({
        where: { organizationId: input.organizationId, id: { in: amendmentIds } },
        select: {
          id: true,
          bookingId: true,
          status: true,
          direction: true,
          appliedAt: true,
          paymentProviderCode: true,
          currency: true,
          beforeTotalMinor: true,
          afterTotalMinor: true,
          deltaMinor: true,
          beforePricingFingerprint: true,
          afterPricingFingerprint: true,
        },
      }),
      transaction.hospitalityBookingPricingEvidence.findMany({
        where: {
          organizationId: input.organizationId,
          id: { in: targetPricingEvidenceIds },
          source: 'COMMERCIAL_AMENDMENT_TARGET',
        },
        select: {
          id: true,
          bookingId: true,
          commercialAmendmentId: true,
          source: true,
          currency: true,
          totalMinor: true,
          pricingFingerprint: true,
        },
      }),
    ]);
    const sourceInvoices = sourceInvoiceRows
      .map((row) => sourceInvoiceAuthorityFromRow(row, input.organizationId))
      .filter((source): source is CommercialSourceInvoiceAuthority => source !== null);
    const amendmentById = new Map(amendments.map((amendment) => [amendment.id, amendment]));
    const authorityGroups = selectVerifiedHospitalityCommercialSettlementAuthorityGroups({
      authorities: parsedAuthorities,
      sourceInvoices,
      amendments,
      targetPricingEvidence,
    });
    const validAuthorities = [...authorityGroups.values()].flat();
    if (validAuthorities.length === 0) {
      return Object.freeze({ status: 'OK' as const, failures: Object.freeze([] as HospitalityTaxDocumentReconciliationFailure[]) });
    }

    const bookingIds = [...new Set(validAuthorities.map((authority) => authority.bookingId))];
    const latestIssueTime = validAuthorities.reduce(
      (latest, authority) => authority.issuedAt.getTime() > latest.getTime() ? authority.issuedAt : latest,
      validAuthorities[0]!.issuedAt,
    );
    const transactions = await transaction.paymentTransaction.findMany({
      where: {
        organizationId: input.organizationId,
        bookingId: { in: bookingIds },
        createdAt: { lte: latestIssueTime },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: COMMERCIAL_SETTLEMENT_TRANSACTION_LIMIT + 1,
      select: {
        bookingId: true,
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
    });
    if (transactions.length > COMMERCIAL_SETTLEMENT_TRANSACTION_LIMIT) {
      return Object.freeze({ status: 'TRANSACTION_LIMIT_EXCEEDED' as const });
    }

    const currentSettlements: HospitalityTaxDocumentCurrentCommercialSettlement[] = [];
    for (const authority of validAuthorities) {
      const amendment = amendmentById.get(authority.commercialAmendmentId)!;
      const group = authorityGroups.get(`${authority.bookingId}:${authority.sourceInvoiceId}`);
      if (!group) continue;
      const allowedAmendmentIds = new Set(
        group
          .filter((candidate) => candidate.sourceAdjustmentOrdinal <= authority.sourceAdjustmentOrdinal)
          .map((candidate) => candidate.commercialAmendmentId),
      );
      const settlementTransactions = transactions.filter((item) => (
        item.bookingId === authority.bookingId
        && item.createdAt.getTime() <= authority.issuedAt.getTime()
        && (item.commercialAmendmentId === null || allowedAmendmentIds.has(item.commercialAmendmentId))
      ));
      const settlement = deriveHospitalityCommercialAmendmentSettlementState({
        amendmentId: amendment.id,
        direction: amendment.direction,
        paymentProviderCode: amendment.paymentProviderCode,
        currency: amendment.currency,
        beforeTotalMinor: amendment.beforeTotalMinor,
        afterTotalMinor: amendment.afterTotalMinor,
        deltaMinor: amendment.deltaMinor,
        transactions: settlementTransactions,
      });
      const expectedAdjustmentMinor = amendment.deltaMinor < 0n ? -amendment.deltaMinor : amendment.deltaMinor;
      currentSettlements.push(Object.freeze({
        documentNumber: authority.documentNumber,
        state: settlement.state,
        settledAdjustmentMinor: settlement.state === 'CONFLICT' ? 0n : settlement.settledAdjustmentMinor,
        remainingAdjustmentMinor: settlement.state === 'CONFLICT' ? expectedAdjustmentMinor : settlement.remainingAdjustmentMinor,
        netSettledMinor: settlement.state === 'CONFLICT' ? 0n : settlement.netSettledMinor,
        expectedAdjustmentMinor,
        expectedNetSettledMinor: amendment.afterTotalMinor,
      }));
    }

    const drift = findHospitalityCommercialTaxDocumentSettlementDrift({ currentSettlements });
    return Object.freeze({
      status: 'OK' as const,
      failures: Object.freeze(drift.map((item): HospitalityTaxDocumentReconciliationFailure => Object.freeze({
        documentType: 'ADJUSTMENT_NOTE',
        documentNumber: item.documentNumber,
        code: 'SETTLEMENT_DRIFT',
      }))),
    });
  }, { isolationLevel: 'RepeatableRead' });
}
