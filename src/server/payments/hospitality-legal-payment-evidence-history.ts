import type { Prisma } from '../../generated/prisma/client.ts';
import type { BookingSettlementTransaction } from './payment-settlement-domain.ts';

export const HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_PAGE_SIZE = 100;
export const HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_MAX_TRANSACTIONS = 5_000;

const MAX_LEGAL_PAYMENT_EVIDENCE_PAGES =
  HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_MAX_TRANSACTIONS / HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_PAGE_SIZE;

type HospitalityLegalPaymentEvidenceReader = Pick<Prisma.TransactionClient, 'paymentTransaction'>;

export type HospitalityLegalPaymentEvidenceTransaction = BookingSettlementTransaction & Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  commercialAmendmentId: string | null;
  createdAt: Date;
}>;

type HospitalityLegalPaymentEvidenceHistoryResult = Readonly<
  | { complete: true; transactions: readonly HospitalityLegalPaymentEvidenceTransaction[] }
  | { complete: false; reason: string }
>;

const legalEvidenceSelect = {
  id: true,
  organizationId: true,
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
} as const;

function legalEvidenceWhere(input: Readonly<{
  organizationId: string;
  bookingId: string;
  through?: Date;
}>) {
  return {
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    ...(input.through ? { createdAt: { lte: input.through } } : {}),
  };
}

function validateLegalEvidenceRow(
  row: HospitalityLegalPaymentEvidenceTransaction,
  organizationId: string,
  bookingId: string,
): string | null {
  if (row.organizationId !== organizationId || row.bookingId !== bookingId) {
    return 'Hospitality legal payment evidence returned data outside the requested tenant booking scope.';
  }
  if (!(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())) {
    return 'Hospitality legal payment evidence contains an invalid database creation timestamp.';
  }
  return null;
}

function completeLegalEvidenceHistory(
  rows: readonly HospitalityLegalPaymentEvidenceTransaction[],
): HospitalityLegalPaymentEvidenceHistoryResult {
  return Object.freeze({
    complete: true as const,
    transactions: Object.freeze([...rows].sort((left, right) => {
      const chronology = left.createdAt.getTime() - right.createdAt.getTime();
      if (chronology !== 0) return chronology;
      return left.id.localeCompare(right.id);
    })),
  });
}

export async function readHospitalityLegalPaymentEvidenceHistory(input: Readonly<{
  transaction: HospitalityLegalPaymentEvidenceReader;
  organizationId: string;
  bookingId: string;
  through?: Date;
}>): Promise<HospitalityLegalPaymentEvidenceHistoryResult> {
  if (input.through && (!(input.through instanceof Date) || Number.isNaN(input.through.getTime()))) {
    return Object.freeze({
      complete: false as const,
      reason: 'Hospitality legal payment evidence requires a valid issue-time horizon.',
    });
  }

  const transactions: HospitalityLegalPaymentEvidenceTransaction[] = [];
  let cursorId: string | undefined;
  const where = legalEvidenceWhere(input);

  for (let pageIndex = 0; pageIndex < MAX_LEGAL_PAYMENT_EVIDENCE_PAGES; pageIndex += 1) {
    const rows = await input.transaction.paymentTransaction.findMany({
      where,
      select: legalEvidenceSelect,
      orderBy: { id: 'asc' },
      take: HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_PAGE_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    for (const row of rows) {
      const transaction = row as HospitalityLegalPaymentEvidenceTransaction;
      const invalidReason = validateLegalEvidenceRow(
        transaction,
        input.organizationId,
        input.bookingId,
      );
      if (invalidReason) {
        return Object.freeze({ complete: false as const, reason: invalidReason });
      }
      transactions.push(transaction);
    }

    if (rows.length < HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_PAGE_SIZE) {
      return completeLegalEvidenceHistory(transactions);
    }
    cursorId = rows.at(-1)?.id;
  }

  if (!cursorId) {
    return Object.freeze({
      complete: false as const,
      reason: 'Hospitality legal payment evidence could not establish a bounded history cursor.',
    });
  }

  const overflow = await input.transaction.paymentTransaction.findMany({
    where,
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 1,
    cursor: { id: cursorId },
    skip: 1,
  });
  if (overflow.length > 0) {
    return Object.freeze({
      complete: false as const,
      reason: `Hospitality legal payment evidence exceeds the ${HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_MAX_TRANSACTIONS}-transaction safety limit.`,
    });
  }

  return completeLegalEvidenceHistory(transactions);
}
