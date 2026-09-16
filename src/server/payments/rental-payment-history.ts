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
}>;

function validateRentalPaymentRequestEvidence(
  row: RentalPaymentHistoryRow,
  organizationId: string,
  bookingId: string,
): string | null {
  if (row.organizationId !== organizationId || row.bookingId !== bookingId) {
    return 'Rental payment history returned evidence outside the requested tenant booking scope.';
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

export async function readRentalPaymentSettlementHistory(input: Readonly<{
  transaction: RentalPaymentHistoryReader;
  organizationId: string;
  bookingId: string;
}>): Promise<RentalPaymentHistoryResult> {
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
      const invalidReason = validateRentalPaymentRequestEvidence(
        row as RentalPaymentHistoryRow,
        input.organizationId,
        input.bookingId,
      );
      if (invalidReason) {
        return Object.freeze({ complete: false as const, reason: invalidReason });
      }
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
      return Object.freeze({ complete: true as const, transactions: Object.freeze(transactions) });
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

  return Object.freeze({ complete: true as const, transactions: Object.freeze(transactions) });
}
