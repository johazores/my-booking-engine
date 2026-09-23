import type { Prisma } from '../../generated/prisma/client.ts';

export const HOSPITALITY_PAYMENT_RECEIPT_PAGE_SIZE = 100;
export const HOSPITALITY_PAYMENT_RECEIPT_MAX_TRANSACTIONS = 1_000;

const MAX_RECEIPT_PAGES = HOSPITALITY_PAYMENT_RECEIPT_MAX_TRANSACTIONS / HOSPITALITY_PAYMENT_RECEIPT_PAGE_SIZE;

type HospitalityPaymentReceiptHistoryReader = Pick<Prisma.TransactionClient, 'paymentTransaction'>;

export type HospitalityPaymentReceiptHistoryTransaction = Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
  status: 'SUCCEEDED';
  providerCode: string;
  providerReference: string;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}>;

type HospitalityPaymentReceiptHistoryResult = Readonly<
  | { complete: true; transactions: readonly HospitalityPaymentReceiptHistoryTransaction[] }
  | { complete: false; reason: string }
>;

const receiptHistorySelect = {
  id: true,
  organizationId: true,
  bookingId: true,
  kind: true,
  status: true,
  providerCode: true,
  providerReference: true,
  currency: true,
  amountMinor: true,
  createdAt: true,
} as const;

function validateReceiptHistoryRow(
  row: HospitalityPaymentReceiptHistoryTransaction,
  organizationId: string,
  bookingId: string,
): string | null {
  if (row.organizationId !== organizationId || row.bookingId !== bookingId) {
    return 'Hospitality payment receipt history returned evidence outside the requested tenant booking scope.';
  }
  if (row.status !== 'SUCCEEDED') {
    return 'Hospitality payment receipt history returned non-successful payment evidence.';
  }
  if (!(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())) {
    return 'Hospitality payment receipt history contains evidence with an invalid database creation timestamp.';
  }
  return null;
}

function completeReceiptHistory(
  rows: readonly HospitalityPaymentReceiptHistoryTransaction[],
): HospitalityPaymentReceiptHistoryResult {
  return Object.freeze({
    complete: true as const,
    transactions: Object.freeze([...rows].sort((left, right) => {
      const chronology = left.createdAt.getTime() - right.createdAt.getTime();
      if (chronology !== 0) return chronology;
      return left.id.localeCompare(right.id);
    })),
  });
}

export async function readHospitalityPaymentReceiptHistory(input: Readonly<{
  transaction: HospitalityPaymentReceiptHistoryReader;
  organizationId: string;
  bookingId: string;
}>): Promise<HospitalityPaymentReceiptHistoryResult> {
  const transactions: HospitalityPaymentReceiptHistoryTransaction[] = [];
  let cursorId: string | undefined;

  for (let pageIndex = 0; pageIndex < MAX_RECEIPT_PAGES; pageIndex += 1) {
    const rows = await input.transaction.paymentTransaction.findMany({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        status: 'SUCCEEDED',
      },
      select: receiptHistorySelect,
      orderBy: { id: 'asc' },
      take: HOSPITALITY_PAYMENT_RECEIPT_PAGE_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    for (const row of rows) {
      const transaction = row as HospitalityPaymentReceiptHistoryTransaction;
      const invalidReason = validateReceiptHistoryRow(
        transaction,
        input.organizationId,
        input.bookingId,
      );
      if (invalidReason) {
        return Object.freeze({ complete: false as const, reason: invalidReason });
      }
      transactions.push(transaction);
    }

    if (rows.length < HOSPITALITY_PAYMENT_RECEIPT_PAGE_SIZE) {
      return completeReceiptHistory(transactions);
    }
    cursorId = rows.at(-1)?.id;
  }

  if (!cursorId) {
    return Object.freeze({
      complete: false as const,
      reason: 'Hospitality payment receipt history could not establish a bounded cursor.',
    });
  }

  const overflow = await input.transaction.paymentTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      status: 'SUCCEEDED',
    },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 1,
    cursor: { id: cursorId },
    skip: 1,
  });
  if (overflow.length > 0) {
    return Object.freeze({
      complete: false as const,
      reason: `Hospitality payment receipt history exceeds the ${HOSPITALITY_PAYMENT_RECEIPT_MAX_TRANSACTIONS}-transaction presentation safety limit.`,
    });
  }

  return completeReceiptHistory(transactions);
}
