import type { Prisma } from '../../generated/prisma/client.ts';
import type { HospitalityCommercialAmendmentRecoveryTransaction } from '../bookings/booking-commercial-amendment-recovery-domain.ts';

export const HOSPITALITY_PAYMENT_RECOVERY_PAGE_SIZE = 100;
export const HOSPITALITY_PAYMENT_RECOVERY_MAX_TRANSACTIONS = 1_000;

const MAX_RECOVERY_PAGES = HOSPITALITY_PAYMENT_RECOVERY_MAX_TRANSACTIONS / HOSPITALITY_PAYMENT_RECOVERY_PAGE_SIZE;

type HospitalityPaymentRecoveryHistoryReader = Pick<Prisma.TransactionClient, 'paymentTransaction'>;

export type HospitalityPaymentRecoveryTransaction = HospitalityCommercialAmendmentRecoveryTransaction & Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  commercialAmendmentId: string | null;
  idempotencyKey: string;
  requestFingerprint: string | null;
  createdAt: Date;
}>;

type HospitalityPaymentRecoveryHistoryResult = Readonly<
  | { complete: true; transactions: readonly HospitalityPaymentRecoveryTransaction[] }
  | { complete: false; reason: string }
>;

const recoveryHistorySelect = {
  id: true,
  organizationId: true,
  bookingId: true,
  commercialAmendmentId: true,
  idempotencyKey: true,
  requestFingerprint: true,
  kind: true,
  status: true,
  providerCode: true,
  providerReference: true,
  sourceProviderReference: true,
  currency: true,
  amountMinor: true,
  createdAt: true,
} as const;

function validateRecoveryPaymentRow(
  row: HospitalityPaymentRecoveryTransaction,
  organizationId: string,
  bookingId: string,
): string | null {
  if (row.organizationId !== organizationId || row.bookingId !== bookingId) {
    return 'Hospitality recovery payment history returned evidence outside the requested tenant booking scope.';
  }
  if (!(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())) {
    return 'Hospitality recovery payment history contains evidence with an invalid database creation timestamp.';
  }
  return null;
}

function completeRecoveryHistory(
  rows: readonly HospitalityPaymentRecoveryTransaction[],
): HospitalityPaymentRecoveryHistoryResult {
  return Object.freeze({
    complete: true as const,
    transactions: Object.freeze([...rows].sort((left, right) => {
      const chronology = left.createdAt.getTime() - right.createdAt.getTime();
      if (chronology !== 0) return chronology;
      return left.id.localeCompare(right.id);
    })),
  });
}

export async function readHospitalityPaymentRecoveryHistory(input: Readonly<{
  transaction: HospitalityPaymentRecoveryHistoryReader;
  organizationId: string;
  bookingId: string;
}>): Promise<HospitalityPaymentRecoveryHistoryResult> {
  const transactions: HospitalityPaymentRecoveryTransaction[] = [];
  let cursorId: string | undefined;

  for (let pageIndex = 0; pageIndex < MAX_RECOVERY_PAGES; pageIndex += 1) {
    const rows = await input.transaction.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: input.bookingId },
      select: recoveryHistorySelect,
      orderBy: { id: 'asc' },
      take: HOSPITALITY_PAYMENT_RECOVERY_PAGE_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    for (const row of rows) {
      const transaction = row as HospitalityPaymentRecoveryTransaction;
      const invalidReason = validateRecoveryPaymentRow(
        transaction,
        input.organizationId,
        input.bookingId,
      );
      if (invalidReason) {
        return Object.freeze({ complete: false as const, reason: invalidReason });
      }
      transactions.push(transaction);
    }

    if (rows.length < HOSPITALITY_PAYMENT_RECOVERY_PAGE_SIZE) {
      return completeRecoveryHistory(transactions);
    }
    cursorId = rows.at(-1)?.id;
  }

  if (!cursorId) {
    return Object.freeze({
      complete: false as const,
      reason: 'Hospitality recovery payment history could not establish a bounded cursor.',
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
      reason: `Hospitality recovery payment history exceeds the ${HOSPITALITY_PAYMENT_RECOVERY_MAX_TRANSACTIONS}-transaction safety limit.`,
    });
  }

  return completeRecoveryHistory(transactions);
}
