import type { Prisma } from '../../generated/prisma/client.ts';

import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { readRentalPaymentSettlementHistory } from '../payments/rental-payment-history.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  buildRentalBookingCommercialAmendmentSettlementRequestFingerprint,
  type RentalBookingCommercialAmendmentSettlementRow,
} from './rental-booking-commercial-amendment-settlement-domain.ts';
import {
  deriveRentalBookingEffectiveSettlement,
  type RentalBookingEffectiveSettlement,
} from './rental-booking-effective-settlement-domain.ts';

export class RentalBookingEffectiveSettlementUnavailableError extends Error {
  constructor() {
    super('Rental booking effective settlement is not available in this organization.');
    this.name = 'RentalBookingEffectiveSettlementUnavailableError';
  }
}

function reconciliationFailure(reason: string): RentalBookingEffectiveSettlement {
  return Object.freeze({ reconciled: false as const, reason });
}

async function readAppliedAmendment(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  bookingId: string,
) {
  const amendments = await transaction.rentalBookingCommercialAmendment.findMany({
    where: { organizationId, bookingId, status: 'APPLIED' },
    orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: 2,
    select: {
      id: true,
      direction: true,
      currency: true,
      beforeTotalMinor: true,
      afterTotalMinor: true,
      deltaMinor: true,
      appliedAt: true,
      appliedRescheduleId: true,
      sourceStartsOn: true,
      sourceEndsOn: true,
      targetStartsOn: true,
      targetEndsOn: true,
      sourcePricingFingerprint: true,
      targetPricingFingerprint: true,
      reviewFingerprint: true,
      appliedReschedule: {
        select: {
          id: true,
          organizationId: true,
          bookingId: true,
          sourceStartsOn: true,
          sourceEndsOn: true,
          targetStartsOn: true,
          targetEndsOn: true,
          currency: true,
          totalMinor: true,
          sourcePricingFingerprint: true,
          targetPricingFingerprint: true,
          authorityFingerprint: true,
          appliedAt: true,
        },
      },
    },
  });
  if (amendments.length > 1) {
    return Object.freeze({
      amendment: amendments[0] ?? null,
      settlement: reconciliationFailure('Rental booking retains more than one applied commercial amendment. Reconcile commercial history before continuing.'),
    });
  }
  return Object.freeze({ amendment: amendments[0] ?? null, settlement: null });
}

async function readAmendmentSettlementRows(
  transaction: Prisma.TransactionClient,
  input: Readonly<{ organizationId: string; bookingId: string; amendmentId: string }>,
) {
  const rows = await transaction.rentalBookingCommercialAmendmentSettlementTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 3,
    select: {
      id: true,
      idempotencyKey: true,
      purpose: true,
      kind: true,
      status: true,
      providerCode: true,
      providerReference: true,
      sourceProviderReference: true,
      currency: true,
      amountMinor: true,
      requestFingerprint: true,
    },
  });
  if (rows.length > 2) {
    return Object.freeze({
      rows: [] as readonly RentalBookingCommercialAmendmentSettlementRow[],
      settlement: reconciliationFailure('Applied rental commercial amendment settlement exceeds the supported adjustment and compensation contract.'),
    });
  }

  const normalized: RentalBookingCommercialAmendmentSettlementRow[] = [];
  for (const row of rows) {
    if (
      (row.purpose !== 'ADJUSTMENT' && row.purpose !== 'COMPENSATION')
      || (row.kind !== 'OFFLINE_PAYMENT' && row.kind !== 'REFUND')
      || row.status !== 'SUCCEEDED'
    ) {
      return Object.freeze({
        rows: [] as readonly RentalBookingCommercialAmendmentSettlementRow[],
        settlement: reconciliationFailure('Applied rental commercial amendment settlement contains unsupported lifecycle or provider evidence.'),
      });
    }
    const expectedFingerprint = buildRentalBookingCommercialAmendmentSettlementRequestFingerprint({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
      idempotencyKey: row.idempotencyKey,
      purpose: row.purpose,
      kind: row.kind,
      providerCode: row.providerCode,
      providerReference: row.providerReference,
      sourceProviderReference: row.sourceProviderReference,
      currency: row.currency,
      amountMinor: row.amountMinor,
    });
    if (row.requestFingerprint !== expectedFingerprint) {
      return Object.freeze({
        rows: [] as readonly RentalBookingCommercialAmendmentSettlementRow[],
        settlement: reconciliationFailure('Applied rental commercial amendment settlement contains invalid retained request evidence.'),
      });
    }
    normalized.push({
      purpose: row.purpose,
      kind: row.kind,
      status: row.status,
      providerCode: row.providerCode,
      providerReference: row.providerReference,
      sourceProviderReference: row.sourceProviderReference,
      currency: row.currency,
      amountMinor: row.amountMinor,
    } as RentalBookingCommercialAmendmentSettlementRow);
  }
  return Object.freeze({ rows: Object.freeze(normalized), settlement: null });
}

export async function readRentalBookingEffectiveSettlementInTransaction(input: Readonly<{
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
}>) {
  const booking = await input.transaction.rentalBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    select: { id: true, status: true, currency: true, totalMinor: true },
  });
  if (!booking) throw new RentalBookingEffectiveSettlementUnavailableError();

  const [paymentHistory, appliedResult] = await Promise.all([
    readRentalPaymentSettlementHistory({
      transaction: input.transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    }),
    readAppliedAmendment(input.transaction, input.organizationId, input.bookingId),
  ]);

  if (!paymentHistory.complete) {
    return Object.freeze({
      booking,
      appliedAmendment: appliedResult.amendment,
      settlement: reconciliationFailure(paymentHistory.reason),
    });
  }
  if (appliedResult.settlement) {
    return Object.freeze({ booking, appliedAmendment: appliedResult.amendment, settlement: appliedResult.settlement });
  }
  if (!appliedResult.amendment) {
    return Object.freeze({
      booking,
      appliedAmendment: null,
      settlement: deriveRentalBookingEffectiveSettlement({
        originalBookingTotalMinor: booking.totalMinor,
        currency: booking.currency,
        originalTransactions: paymentHistory.transactions,
      }),
    });
  }
  const appliedReschedule = appliedResult.amendment.appliedReschedule;
  if (
    !appliedResult.amendment.appliedAt
    || !appliedResult.amendment.appliedRescheduleId
    || !appliedReschedule
    || appliedReschedule.id !== appliedResult.amendment.appliedRescheduleId
    || appliedReschedule.organizationId !== input.organizationId
    || appliedReschedule.bookingId !== input.bookingId
    || appliedReschedule.sourceStartsOn.getTime() !== appliedResult.amendment.sourceStartsOn.getTime()
    || appliedReschedule.sourceEndsOn.getTime() !== appliedResult.amendment.sourceEndsOn.getTime()
    || appliedReschedule.targetStartsOn.getTime() !== appliedResult.amendment.targetStartsOn.getTime()
    || appliedReschedule.targetEndsOn.getTime() !== appliedResult.amendment.targetEndsOn.getTime()
    || appliedReschedule.currency !== appliedResult.amendment.currency
    || appliedReschedule.totalMinor !== appliedResult.amendment.afterTotalMinor
    || appliedReschedule.sourcePricingFingerprint !== appliedResult.amendment.sourcePricingFingerprint
    || appliedReschedule.targetPricingFingerprint !== appliedResult.amendment.targetPricingFingerprint
    || appliedReschedule.authorityFingerprint !== appliedResult.amendment.reviewFingerprint
    || appliedReschedule.appliedAt.getTime() !== appliedResult.amendment.appliedAt.getTime()
  ) {
    return Object.freeze({
      booking,
      appliedAmendment: appliedResult.amendment,
      settlement: reconciliationFailure('Applied rental commercial amendment does not retain matching terminal reschedule evidence.'),
    });
  }

  const amendmentRows = await readAmendmentSettlementRows(input.transaction, {
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    amendmentId: appliedResult.amendment.id,
  });
  if (amendmentRows.settlement) {
    return Object.freeze({ booking, appliedAmendment: appliedResult.amendment, settlement: amendmentRows.settlement });
  }

  return Object.freeze({
    booking,
    appliedAmendment: appliedResult.amendment,
    settlement: deriveRentalBookingEffectiveSettlement({
      originalBookingTotalMinor: booking.totalMinor,
      currency: booking.currency,
      originalTransactions: paymentHistory.transactions,
      appliedAmendment: {
        id: appliedResult.amendment.id,
        direction: appliedResult.amendment.direction,
        currency: appliedResult.amendment.currency,
        beforeTotalMinor: appliedResult.amendment.beforeTotalMinor,
        afterTotalMinor: appliedResult.amendment.afterTotalMinor,
        deltaMinor: appliedResult.amendment.deltaMinor,
        settlementRows: amendmentRows.rows,
      },
    }),
  });
}

export async function readRentalBookingEffectiveSettlement(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');

  await Promise.all([
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'booking:read',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'payment:read',
    }),
  ]);

  return db.$transaction(
    (transaction) => readRentalBookingEffectiveSettlementInTransaction({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    }),
    { isolationLevel: 'RepeatableRead' },
  );
}
