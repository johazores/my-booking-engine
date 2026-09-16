import type { Prisma } from '../../generated/prisma/client.ts';
import type { BookingSettlementTransaction } from './payment-settlement-domain.ts';
import { buildRentalPaymentIdempotencyKey, buildRentalPaymentRequestFingerprint } from './rental-payment-domain.ts';

export const RENTAL_PAYMENT_SETTLEMENT_PAGE_SIZE = 100;
export const RENTAL_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS = 1_000;

const MAX_SETTLEMENT_PAGES = RENTAL_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS / RENTAL_PAYMENT_SETTLEMENT_PAGE_SIZE;

type RentalPaymentHistoryReader = Pick<Prisma.TransactionClient, 'rentalPaymentTransaction'>;

type RentalPaymentHistoryResult = Readonly<
  | { complete: true; transactions: readonly BookingSettlementTransaction[] }
  | { complete: false; reason: string }
>;

const historySelect = {
  id: true,
  organizationId: true,
  bookingId: true,
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

type RentalPaymentHistoryRow = Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  idempotencyKey: string;
  requestFingerprint: string | null;
  kind: BookingSettlementTransaction['kind'];
  status: BookingSettlementTransaction['status'];
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}>;

function validateRentalPaymentRequestEvidence(
  row: RentalPaymentHistoryRow,
  organizationId: string,
  bookingId: string,
): string | null {
  if (row.organizationId !== organizationId || row.bookingId !== bookingId) {
    return 'Rental payment history returned evidence outside the requested tenant booking scope.';
  }
  if (!(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())) {
    return 'Rental payment history contains settlement evidence with an invalid database creation timestamp.';
  }
  if (row.providerCode !== 'manual' || (row.kind !== 'OFFLINE_PAYMENT' && row.kind !== 'REFUND')) {
    return null;
  }

  const expectedIdempotencyKey = buildRentalPaymentIdempotencyKey({
    kind: row.kind === 'OFFLINE_PAYMENT' ? 'manual-payment' : 'manual-refund',
    bookingId: row.bookingId,
    reference: row.providerReference,
  });
  if (row.idempotencyKey !== expectedIdempotencyKey) {
    return 'Rental payment history contains settlement evidence with invalid deterministic idempotency authority.';
  }

  if (row.requestFingerprint === null) return null;
  const expectedRequestFingerprint = buildRentalPaymentRequestFingerprint({
    organizationId: row.organizationId,
    bookingId: row.bookingId,
    idempotencyKey: row.idempotencyKey,
    kind: row.kind,
    providerCode: row.providerCode,
    providerReference: row.providerReference,
    sourceProviderReference: row.sourceProviderReference,
    currency: row.currency,
    amountMinor: row.amountMinor,
  });
  if (row.requestFingerprint !== expectedRequestFingerprint) {
    return 'Rental payment history contains settlement evidence with an invalid request fingerprint.';
  }

  return null;
}

function validateRentalPaymentChronology(rows: readonly RentalPaymentHistoryRow[]): string | null {
  const sourceCreatedAtByReference = new Map<string, number>();

  for (const row of rows) {
    if (
      row.status === 'SUCCEEDED'
      && row.providerCode === 'manual'
      && row.kind === 'OFFLINE_PAYMENT'
    ) {
      sourceCreatedAtByReference.set(row.providerReference, row.createdAt.getTime());
    }
  }

  for (const row of rows) {
    if (
      row.status !== 'SUCCEEDED'
      || row.providerCode !== 'manual'
      || row.kind !== 'REFUND'
    ) {
      continue;
    }

    if (row.sourceProviderReference === null) {
      return 'Rental refund history is missing its retained settlement source chronology.';
    }
    const sourceCreatedAt = sourceCreatedAtByReference.get(row.sourceProviderReference);
    if (sourceCreatedAt === undefined) {
      return 'Rental refund history does not have retained source-payment chronology.';
    }
    if (row.createdAt.getTime() < sourceCreatedAt) {
      return 'Rental refund history predates its retained source payment.';
    }
  }

  return null;
}

function completeRentalPaymentHistory(
  evidenceRows: readonly RentalPaymentHistoryRow[],
  transactions: readonly BookingSettlementTransaction[],
): RentalPaymentHistoryResult {
  const chronologyReason = validateRentalPaymentChronology(evidenceRows);
  if (chronologyReason) {
    return Object.freeze({ complete: false as const, reason: chronologyReason });
  }
  return Object.freeze({ complete: true as const, transactions: Object.freeze([...transactions]) });
}

export async function readRentalPaymentSettlementHistory(input: Readonly<{
  transaction: RentalPaymentHistoryReader;
  organizationId: string;
  bookingId: string;
}>): Promise<RentalPaymentHistoryResult> {
  const evidenceRows: RentalPaymentHistoryRow[] = [];
  const transactions: BookingSettlementTransaction[] = [];
  let cursorId: string | undefined;

  for (let pageIndex = 0; pageIndex < MAX_SETTLEMENT_PAGES; pageIndex += 1) {
    const rows = await input.transaction.rentalPaymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: input.bookingId },
      select: historySelect,
      orderBy: { id: 'asc' },
      take: RENTAL_PAYMENT_SETTLEMENT_PAGE_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    for (const row of rows) {
      const evidenceRow = row as RentalPaymentHistoryRow;
      const invalidReason = validateRentalPaymentRequestEvidence(
        evidenceRow,
        input.organizationId,
        input.bookingId,
      );
      if (invalidReason) {
        return Object.freeze({ complete: false as const, reason: invalidReason });
      }
      evidenceRows.push(evidenceRow);
      transactions.push({
        kind: row.kind,
        status: row.status,
        providerCode: row.providerCode,
        providerReference: row.providerReference,
        sourceProviderReference: row.sourceProviderReference,
        currency: row.currency,
        amountMinor: row.amountMinor,
      });
    }

    if (rows.length < RENTAL_PAYMENT_SETTLEMENT_PAGE_SIZE) {
      return completeRentalPaymentHistory(evidenceRows, transactions);
    }
    cursorId = rows.at(-1)?.id;
  }

  if (!cursorId) {
    return Object.freeze({
      complete: false as const,
      reason: 'Rental payment history could not establish a bounded settlement cursor.',
    });
  }

  const overflow = await input.transaction.rentalPaymentTransaction.findMany({
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
      reason: `Rental payment history exceeds the ${RENTAL_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS}-transaction reconciliation safety limit.`,
    });
  }

  return completeRentalPaymentHistory(evidenceRows, transactions);
}
