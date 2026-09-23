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
} from './hospitality-commercial-settlement-reconciliation-authority-domain.ts';
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

export async function currentHospitalityCommercialAdjustmentSettlementDriftFailures(input: {
  organizationId: string;
  documentLimit: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  if (!Number.isSafeInteger(input.documentLimit) || input.documentLimit < 1) {
    throw new RangeError('documentLimit must be a positive safe integer.');
  }

  const issued = await db.hospitalityIssuedAdjustmentNote.findMany({
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

  const amendmentIds = [...new Set(parsedAuthorities.map((authority) => authority.commercialAmendmentId))];
  const targetPricingEvidenceIds = [...new Set(parsedAuthorities.map((authority) => authority.targetPricingEvidenceId))];
  const [amendments, targetPricingEvidence] = await Promise.all([
    db.hospitalityBookingCommercialAmendment.findMany({
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
    db.hospitalityBookingPricingEvidence.findMany({
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
  const amendmentById = new Map(amendments.map((amendment) => [amendment.id, amendment]));
  const authorityGroups = selectVerifiedHospitalityCommercialSettlementAuthorityGroups({
    authorities: parsedAuthorities,
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
  const transactions = await db.paymentTransaction.findMany({
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
    const settlementTransactions = transactions.filter((transaction) => (
      transaction.bookingId === authority.bookingId
      && transaction.createdAt.getTime() <= authority.issuedAt.getTime()
      && (transaction.commercialAmendmentId === null || allowedAmendmentIds.has(transaction.commercialAmendmentId))
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
}
