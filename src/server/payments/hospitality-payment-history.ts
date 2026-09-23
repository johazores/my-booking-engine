import type { Prisma } from '../../generated/prisma/client.ts';
import type { BookingSettlementTransaction } from './payment-settlement-domain.ts';

export const HOSPITALITY_PAYMENT_SETTLEMENT_PAGE_SIZE = 100;
export const HOSPITALITY_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS = 1_000;

const MAX_SETTLEMENT_PAGES = HOSPITALITY_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS / HOSPITALITY_PAYMENT_SETTLEMENT_PAGE_SIZE;

type HospitalityPaymentHistoryReader = Pick<Prisma.TransactionClient, 'paymentTransaction'>;

export type HospitalityPaymentSettlementTransaction = BookingSettlementTransaction & Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  commercialAmendmentId: string | null;
  createdAt: Date;
}>;

type HospitalityPaymentHistoryResult = Readonly<
  | { complete: true; transactions: readonly HospitalityPaymentSettlementTransaction[] }
  | { complete: false; reason: string }
>;

const historySelect = {
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

function validateHospitalityPaymentRow(
  row: HospitalityPaymentSettlementTransaction,
  organizationId: string,
  bookingId: string,
): string | null {
  if (row.organizationId !== organizationId || row.bookingId !== bookingId) {
    return 'Hospitality payment history returned evidence outside the requested tenant booking scope.';
  }
  if (!(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())) {
    return 'Hospitality payment history contains settlement evidence with an invalid database creation timestamp.';
  }
  return null;
}

function completeHospitalityPaymentHistory(rows: readonly HospitalityPaymentSettlementTransaction[]): HospitalityPaymentHistoryResult {
  return Object.freeze({
    complete: true as const,
    transactions: Object.freeze([...rows].sort((left, right) => {
      const chronology = left.createdAt.getTime() - right.createdAt.getTime();
      if (chronology !== 0) return chronology;
      return left.id.localeCompare(right.id);
    })),
  });
}

export async function readHospitalityPaymentSettlementHistory(input: Readonly<{
  transaction: HospitalityPaymentHistoryReader;
  organizationId: string;
  bookingId: string;
}>): Promise<HospitalityPaymentHistoryResult> {
  const transactions: HospitalityPaymentSettlementTransaction[] = [];
  let cursorId: string | undefined;

  for (let pageIndex = 0; pageIndex < MAX_SETTLEMENT_PAGES; pageIndex += 1) {
    const rows = await input.transaction.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: input.bookingId },
      select: historySelect,
      orderBy: { id: 'asc' },
      take: HOSPITALITY_PAYMENT_SETTLEMENT_PAGE_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    for (const row of rows) {
      const transaction = row as HospitalityPaymentSettlementTransaction;
      const invalidReason = validateHospitalityPaymentRow(
        transaction,
        input.organizationId,
        input.bookingId,
      );
      if (invalidReason) {
        return Object.freeze({ complete: false as const, reason: invalidReason });
      }
      transactions.push(transaction);
    }

    if (rows.length < HOSPITALITY_PAYMENT_SETTLEMENT_PAGE_SIZE) {
      return completeHospitalityPaymentHistory(transactions);
    }
    cursorId = rows.at(-1)?.id;
  }

  if (!cursorId) {
    return Object.freeze({
      complete: false as const,
      reason: 'Hospitality payment history could not establish a bounded settlement cursor.',
    });
  }

  const overflow = await input.transaction.paymentTransaction.findMany({
    where: { organizationId: input.organizationId, bookingId: input.bookingId },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 1,
    cursor: { id: cursorId },
    skip: 1,
  });
  if (overflow.length > 0) {
    return Object.freeze({
      complete: false as const,
      reason: `Hospitality payment history exceeds the ${HOSPITALITY_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS}-transaction reconciliation safety limit.`,
    });
  }

  return completeHospitalityPaymentHistory(transactions);
}
