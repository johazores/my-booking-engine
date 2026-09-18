import type { Prisma } from '../../generated/prisma/client.ts';

import {
  buildRentalBookingEffectiveRefundIdempotencyKey,
  buildRentalBookingEffectiveRefundRequestFingerprint,
} from './rental-booking-effective-refund-domain.ts';
import type { RentalBookingEffectiveRefundEvidence } from './rental-booking-effective-settlement-domain.ts';

export const RENTAL_BOOKING_EFFECTIVE_REFUND_PAGE_SIZE = 100;
export const RENTAL_BOOKING_EFFECTIVE_REFUND_MAX_TRANSACTIONS = 1_000;

const MAX_PAGES =
  RENTAL_BOOKING_EFFECTIVE_REFUND_MAX_TRANSACTIONS / RENTAL_BOOKING_EFFECTIVE_REFUND_PAGE_SIZE;

type EffectiveRefundHistoryReader = Pick<
  Prisma.TransactionClient,
  'rentalBookingEffectiveRefundTransaction'
>;

type EffectiveRefundHistoryResult = Readonly<
  | {
      complete: true;
      transactions: readonly RentalBookingEffectiveRefundEvidence[];
    }
  | {
      complete: false;
      reason: string;
    }
>;

const historySelect = {
  id: true,
  organizationId: true,
  bookingId: true,
  amendmentId: true,
  idempotencyKey: true,
  requestFingerprint: true,
  sourceLedger: true,
  status: true,
  providerCode: true,
  providerReference: true,
  sourceProviderReference: true,
  currency: true,
  amountMinor: true,
  createdAt: true,
} as const;

export async function readRentalBookingEffectiveRefundHistory(input: Readonly<{
  transaction: EffectiveRefundHistoryReader;
  organizationId: string;
  bookingId: string;
  amendmentId: string;
  appliedAt: Date;
}>): Promise<EffectiveRefundHistoryResult> {
  const transactions: RentalBookingEffectiveRefundEvidence[] = [];
  let cursorId: string | undefined;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    const rows = await input.transaction.rentalBookingEffectiveRefundTransaction.findMany({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
      },
      select: historySelect,
      orderBy: { id: 'asc' },
      take: RENTAL_BOOKING_EFFECTIVE_REFUND_PAGE_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    for (const row of rows) {
      if (
        row.organizationId !== input.organizationId
        || row.bookingId !== input.bookingId
        || row.amendmentId !== input.amendmentId
        || !(row.createdAt instanceof Date)
        || Number.isNaN(row.createdAt.getTime())
        || row.createdAt.getTime() < input.appliedAt.getTime()
        || (row.sourceLedger !== 'BOOKING_PRICE' && row.sourceLedger !== 'COMMERCIAL_AMENDMENT')
        || row.status !== 'SUCCEEDED'
        || row.providerCode !== 'manual'
        || !row.sourceProviderReference
      ) {
        return Object.freeze({
          complete: false as const,
          reason: 'Post-apply rental refund history contains invalid tenant, lifecycle, provider, or chronology evidence.',
        });
      }

      const expectedIdempotencyKey = buildRentalBookingEffectiveRefundIdempotencyKey({
        bookingId: row.bookingId,
        amendmentId: row.amendmentId,
        reference: row.providerReference,
      });
      if (row.idempotencyKey !== expectedIdempotencyKey) {
        return Object.freeze({
          complete: false as const,
          reason: 'Post-apply rental refund history contains invalid deterministic idempotency authority.',
        });
      }

      const expectedFingerprint = buildRentalBookingEffectiveRefundRequestFingerprint({
        organizationId: row.organizationId,
        bookingId: row.bookingId,
        amendmentId: row.amendmentId,
        idempotencyKey: row.idempotencyKey,
        sourceLedger: row.sourceLedger,
        providerCode: row.providerCode,
        providerReference: row.providerReference,
        sourceProviderReference: row.sourceProviderReference,
        currency: row.currency,
        amountMinor: row.amountMinor,
      });
      if (row.requestFingerprint !== expectedFingerprint) {
        return Object.freeze({
          complete: false as const,
          reason: 'Post-apply rental refund history contains an invalid retained request fingerprint.',
        });
      }

      transactions.push(Object.freeze({
        sourceLedger: row.sourceLedger,
        status: 'SUCCEEDED' as const,
        providerCode: row.providerCode,
        providerReference: row.providerReference,
        sourceProviderReference: row.sourceProviderReference,
        currency: row.currency,
        amountMinor: row.amountMinor,
      }));
    }

    if (rows.length < RENTAL_BOOKING_EFFECTIVE_REFUND_PAGE_SIZE) {
      return Object.freeze({
        complete: true as const,
        transactions: Object.freeze(transactions),
      });
    }
    cursorId = rows.at(-1)?.id;
  }

  if (!cursorId) {
    return Object.freeze({
      complete: false as const,
      reason: 'Post-apply rental refund history could not establish a bounded settlement cursor.',
    });
  }

  const overflow = await input.transaction.rentalBookingEffectiveRefundTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
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
      reason: `Post-apply rental refund history exceeds the ${RENTAL_BOOKING_EFFECTIVE_REFUND_MAX_TRANSACTIONS}-transaction reconciliation safety limit.`,
    });
  }

  return Object.freeze({
    complete: true as const,
    transactions: Object.freeze(transactions),
  });
}
