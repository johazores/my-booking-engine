import type { Prisma } from '../../generated/prisma/client.ts';

import { isCanonicalManualPaymentReference } from '../payments/manual-payment-provider.ts';
import { validatePaymentHistoryPage } from '../payments/payment-history-page-integrity.ts';
import {
  validateRentalEffectiveRefundSourceOrder,
  type EffectiveRefundOrderEvidence,
} from './rental-booking-effective-refund-order-domain.ts';

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
  'rentalBookingEffectiveRefundTransaction' | 'rentalBookingCommercialAmendment'
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
}>): Promise<EffectiveRefundHistoryResult> {
  // Recheck the applied amendment inside this same transaction; callers
  // cannot supply source-order direction, charge amount, or applied time as authority.
  const amendment = await input.transaction.rentalBookingCommercialAmendment.findFirst({
    where: {
      id: input.amendmentId,
      bookingId: input.bookingId,
      organizationId: input.organizationId,
      status: 'APPLIED',
    },
    select: { direction: true, deltaMinor: true, appliedAt: true },
  });
  if (!amendment) {
    return Object.freeze({
      complete: false as const,
      reason: 'Post-apply rental refund history has no tenant-owned applied amendment authority.',
    });
  }

  if ((amendment.direction !== 'ADDITIONAL_CHARGE' && amendment.direction !== 'REFUND')
    || typeof amendment.deltaMinor !== 'bigint' || amendment.deltaMinor <= 0n) {
    return Object.freeze({
      complete: false as const,
      reason: 'Post-apply rental refund history has invalid amendment authority.',
    });
  }
  if (!(amendment.appliedAt instanceof Date) || !Number.isFinite(amendment.appliedAt.getTime())) {
    return Object.freeze({
      complete: false as const,
      reason: 'Applied rental amendment has an invalid terminal timestamp.',
    });
  }

  const transactions: RentalBookingEffectiveRefundEvidence[] = [];
  const chronologicalRows: EffectiveRefundOrderEvidence[] = [];
  const completeHistory = (): EffectiveRefundHistoryResult => {
    const orderError = validateRentalEffectiveRefundSourceOrder({
      direction: amendment.direction,
      deltaMinor: amendment.deltaMinor,
      rows: chronologicalRows,
    });
    if (orderError) return Object.freeze({ complete: false as const, reason: orderError });
    return Object.freeze({
      complete: true as const,
      transactions: Object.freeze(transactions),
    });
  };
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

    const pageError = validatePaymentHistoryPage(rows, cursorId, RENTAL_BOOKING_EFFECTIVE_REFUND_PAGE_SIZE);
    if (pageError) {
      return Object.freeze({
        complete: false as const,
        reason: pageError === 'page-size'
          ? 'Post-apply rental refund history returned an oversized transaction page.'
          : 'Post-apply rental refund history returned duplicate, missing, or out-of-order transaction IDs.',
      });
    }

    for (const row of rows) {
      if (
        row.organizationId !== input.organizationId
        || row.bookingId !== input.bookingId
        || row.amendmentId !== input.amendmentId
        || !(row.createdAt instanceof Date)
        || Number.isNaN(row.createdAt.getTime())
        || row.createdAt.getTime() < amendment.appliedAt.getTime()
        || (row.sourceLedger !== 'BOOKING_PRICE' && row.sourceLedger !== 'COMMERCIAL_AMENDMENT')
        || row.status !== 'SUCCEEDED'
        || row.providerCode !== 'manual'
        || !isCanonicalManualPaymentReference(row.providerReference)
        || !isCanonicalManualPaymentReference(row.sourceProviderReference)
        || row.sourceProviderReference === row.providerReference
        || typeof row.currency !== 'string'
        || !/^[A-Z]{3}$/.test(row.currency)
        || typeof row.amountMinor !== 'bigint'
        || row.amountMinor <= 0n
        || typeof row.idempotencyKey !== 'string'
        || typeof row.requestFingerprint !== 'string'
      ) {
        return Object.freeze({
          complete: false as const,
          reason: 'Post-apply rental refund history contains invalid tenant, lifecycle, provider, monetary, or chronology evidence.',
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

      chronologicalRows.push(Object.freeze({
        sourceLedger: row.sourceLedger,
        amountMinor: row.amountMinor,
        createdAt: row.createdAt,
      }));
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
      return completeHistory();
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

  return completeHistory();
}
