import type { Prisma } from '../../generated/prisma/client.ts';

import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import {
  buildRentalPricingEvidence,
  RentalAvailabilityIntegrityError,
} from '../inventory/rental-availability-domain.ts';
import { findOverdueRentalCustodyUnitIds } from '../inventory/rental-custody-availability.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { deriveRentalPaymentSettlement } from '../payments/rental-payment-domain.ts';
import { readRentalPaymentSettlementHistory } from '../payments/rental-payment-history.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  deriveRentalBookingCommercialAmendmentSettlementState,
  type RentalBookingCommercialAmendmentSettlementRow,
} from './rental-booking-commercial-amendment-settlement-domain.ts';
import {
  RentalBookingCommercialAmendmentConflictError,
  RentalBookingCommercialAmendmentUnavailableError,
} from './rental-booking-commercial-amendment-service.ts';
import {
  isRentalBookingCustodyExtensionTarget,
  rentalBookingLockKey,
} from './rental-booking-reschedule-domain.ts';
import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';

const commercialAmendmentSettlementLockKey = (organizationId: string, amendmentId: string) =>
  `rental-commercial-amendment-settlement:${organizationId}:${amendmentId}`;

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function runApply<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE' || disposition === 'CONFLICT') {
        throw new RentalBookingCommercialAmendmentConflictError(
          'Rental commercial amendment apply no longer satisfies the durable inventory, pricing, settlement, or lifecycle contract.',
        );
      }
      throw error;
    }
  }
  throw new RentalBookingCommercialAmendmentConflictError(
    'Rental commercial amendment apply could not be serialized.',
  );
}

function applyIdempotencyKey(amendmentId: string) {
  return `rental-commercial-amendment-apply:${amendmentId}`;
}

async function readSettlementRows(
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
      purpose: true,
      kind: true,
      status: true,
      providerCode: true,
      providerReference: true,
      sourceProviderReference: true,
      currency: true,
      amountMinor: true,
    },
  });
  if (rows.length > 2) {
    throw new RentalBookingCommercialAmendmentConflictError(
      'Rental commercial amendment settlement history exceeds the supported adjustment and compensation contract.',
    );
  }
  return rows;
}

async function readAppliedReplay(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    organizationId: string;
    bookingId: string;
    amendment: {
      id: string;
      appliedRescheduleId: string | null;
      appliedAt: Date | null;
      targetStartsOn: Date;
      targetEndsOn: Date;
      afterTotalMinor: bigint;
      targetPricingFingerprint: string;
    };
  }>,
) {
  if (!input.amendment.appliedRescheduleId || !input.amendment.appliedAt) {
    throw new RentalAvailabilityIntegrityError(
      'Applied rental commercial amendment is missing its retained reschedule linkage.',
    );
  }
  const [reschedule, booking, allocation] = await Promise.all([
    transaction.rentalBookingReschedule.findFirst({
      where: {
        id: input.amendment.appliedRescheduleId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
      },
    }),
    transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
    }),
    transaction.rentalBookingAllocation.findFirst({
      where: { bookingId: input.bookingId, organizationId: input.organizationId },
    }),
  ]);
  if (
    !reschedule
    || !booking
    || !allocation
    || reschedule.appliedAt.getTime() !== input.amendment.appliedAt.getTime()
    || reschedule.targetStartsOn.getTime() !== input.amendment.targetStartsOn.getTime()
    || reschedule.targetEndsOn.getTime() !== input.amendment.targetEndsOn.getTime()
    || reschedule.totalMinor !== input.amendment.afterTotalMinor
    || reschedule.targetPricingFingerprint !== input.amendment.targetPricingFingerprint
  ) {
    throw new RentalAvailabilityIntegrityError(
      'Applied rental commercial amendment does not retain matching reschedule evidence.',
    );
  }
  return Object.freeze({ amendment: input.amendment, booking, allocation, reschedule, applied: false as const, idempotent: true as const });
}

export async function applyRentalBookingCommercialAmendment(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);

  return runApply(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0)
      )
    `;
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${commercialAmendmentSettlementLockKey(input.organizationId, input.amendmentId)}, 0)
      )
    `;

    const amendmentLocator = await transaction.rentalBookingCommercialAmendment.findFirst({
      where: {
        id: input.amendmentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
      },
    });
    if (!amendmentLocator) throw new RentalBookingCommercialAmendmentUnavailableError();
    if (amendmentLocator.status === 'APPLIED') {
      return readAppliedReplay(transaction, {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        amendment: amendmentLocator,
      });
    }
    if (amendmentLocator.status !== 'PREPARED') {
      throw new RentalBookingCommercialAmendmentConflictError(
        `Rental commercial amendment state ${amendmentLocator.status.toLowerCase()} cannot be applied.`,
      );
    }

    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError(
        'Database time authority is unavailable for rental commercial amendment apply.',
      );
    }
    if (amendmentLocator.expiresAt <= databaseClock.now) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental commercial amendment authority expired before final apply. Compensate retained adjustment money before terminating the amendment.',
      );
    }

    const [bookingLocator, allocationLocator, latestSubstitutionLocator] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: {
          id: input.bookingId,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
          cancelledAt: null,
        },
        select: { unitId: true },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: { bookingId: input.bookingId, organizationId: input.organizationId },
        select: { unitId: true },
      }),
      transaction.rentalBookingUnitSubstitution.findFirst({
        where: { bookingId: input.bookingId, organizationId: input.organizationId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: { targetUnitId: true },
      }),
    ]);
    if (!bookingLocator || !allocationLocator) {
      throw new RentalBookingCommercialAmendmentUnavailableError(
        'Rental booking no longer retains the allocation required for commercial amendment apply.',
      );
    }
    const effectiveUnitId = latestSubstitutionLocator?.targetUnitId ?? bookingLocator.unitId;
    if (effectiveUnitId !== amendmentLocator.unitId || allocationLocator.unitId !== effectiveUnitId) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental commercial amendment physical-unit authority changed before final apply.',
      );
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, effectiveUnitId)}, 0)
      )
    `;
    const [authorityClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!authorityClock?.now) {
      throw new RentalAvailabilityIntegrityError(
        'Database time authority is unavailable after rental commercial amendment inventory lock.',
      );
    }
    if (amendmentLocator.expiresAt <= authorityClock.now) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental commercial amendment authority expired while final apply waited for inventory authority. Compensate retained adjustment money before terminating the amendment.',
      );
    }

    const [amendment, booking, latestReschedule, latestSubstitution] = await Promise.all([
      transaction.rentalBookingCommercialAmendment.findFirst({
        where: {
          id: input.amendmentId,
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          status: 'PREPARED',
        },
      }),
      transaction.rentalBooking.findFirst({
        where: {
          id: input.bookingId,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
          cancelledAt: null,
        },
        include: {
          allocation: {
            include: {
              unit: {
                select: {
                  id: true,
                  status: true,
                  unitTypeId: true,
                  locationId: true,
                  unitType: {
                    select: {
                      id: true,
                      status: true,
                      currency: true,
                      defaultDailyRateMinor: true,
                    },
                  },
                  location: { select: { id: true, status: true } },
                },
              },
            },
          },
          fulfillmentEvents: {
            where: { organizationId: input.organizationId },
            orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, kind: true, occurredAt: true },
          },
        },
      }),
      transaction.rentalBookingReschedule.findFirst({
        where: { organizationId: input.organizationId, bookingId: input.bookingId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.rentalBookingUnitSubstitution.findFirst({
        where: { organizationId: input.organizationId, bookingId: input.bookingId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    if (!amendment || !booking || !booking.allocation) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental commercial amendment or booking authority changed before final apply.',
      );
    }
    if (booking.updatedAt.getTime() !== amendment.bookingVersion.getTime()) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental booking version changed after commercial amendment preparation.',
      );
    }

    const pickupEvent = booking.fulfillmentEvents.find((event) => event.kind === 'PICKED_UP') ?? null;
    const returnEvent = booking.fulfillmentEvents.find((event) => event.kind === 'RETURNED') ?? null;
    if (returnEvent) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Returned rentals cannot apply a commercial date amendment.',
      );
    }
    if (
      (amendment.mode === 'PRE_PICKUP_RESCHEDULE' && pickupEvent)
      || (amendment.mode === 'CUSTODY_EXTENSION' && pickupEvent?.id !== amendment.pickupEventId)
    ) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental custody authority changed after commercial amendment preparation.',
      );
    }

    const sourceStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const sourceEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
    const sourceTotalMinor = latestReschedule?.totalMinor ?? booking.totalMinor;
    const sourcePricingFingerprint = latestReschedule?.targetPricingFingerprint ?? booking.pricingFingerprint;
    const currentUnitId = latestSubstitution?.targetUnitId ?? booking.unitId;
    const currentUnit = booking.allocation.unit;
    if (
      currentUnitId !== amendment.unitId
      || booking.allocation.organizationId !== input.organizationId
      || booking.allocation.bookingId !== booking.id
      || booking.allocation.unitId !== amendment.unitId
      || currentUnit.id !== amendment.unitId
      || currentUnit.unitTypeId !== amendment.unitTypeId
      || currentUnit.locationId !== amendment.locationId
      || booking.unitTypeId !== amendment.unitTypeId
      || booking.locationId !== amendment.locationId
      || booking.allocation.startsOn.getTime() !== sourceStartsOn.getTime()
      || booking.allocation.endsOn.getTime() !== sourceEndsOn.getTime()
      || sourceStartsOn.getTime() !== amendment.sourceStartsOn.getTime()
      || sourceEndsOn.getTime() !== amendment.sourceEndsOn.getTime()
      || sourceTotalMinor !== amendment.beforeTotalMinor
      || sourcePricingFingerprint !== amendment.sourcePricingFingerprint
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental commercial amendment no longer matches the effective booking allocation or source commercial evidence.',
      );
    }
    if (
      currentUnit.status !== 'ACTIVE'
      || currentUnit.unitType.status !== 'ACTIVE'
      || !currentUnit.location
      || currentUnit.location.status !== 'ACTIVE'
      || currentUnit.unitType.id !== amendment.unitTypeId
      || currentUnit.location.id !== amendment.locationId
    ) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'The effective rental unit is no longer active at the retained commercial amendment assignment.',
      );
    }
    if (
      amendment.mode === 'CUSTODY_EXTENSION'
      && !isRentalBookingCustodyExtensionTarget({
        sourceStartsOn,
        sourceEndsOn,
        targetStartsOn: amendment.targetStartsOn,
        targetEndsOn: amendment.targetEndsOn,
      })
    ) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Retained custody-extension dates no longer satisfy the commercial amendment contract.',
      );
    }

    const [blockOverlap, competingHold, bookingOverlap, overdueCustodyUnitIds, ratePeriods, settlementRows] = await Promise.all([
      transaction.rentalAvailabilityBlock.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: amendment.unitId,
          startsOn: { lt: amendment.targetEndsOn },
          endsOn: { gt: amendment.targetStartsOn },
        },
        select: { id: true },
      }),
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: amendment.unitId,
          status: 'ACTIVE',
          expiresAt: { gt: authorityClock.now },
          startsOn: { lt: amendment.targetEndsOn },
          endsOn: { gt: amendment.targetStartsOn },
        },
        select: { id: true },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: amendment.unitId,
          bookingId: { not: booking.id },
          startsOn: { lt: amendment.targetEndsOn },
          endsOn: { gt: amendment.targetStartsOn },
          booking: { is: { organizationId: input.organizationId, status: { not: 'CANCELLED' } } },
        },
        select: { id: true },
      }),
      findOverdueRentalCustodyUnitIds(transaction, {
        organizationId: input.organizationId,
        observedAt: authorityClock.now,
        unitId: amendment.unitId,
        excludeBookingId: booking.id,
      }),
      transaction.rentalRatePeriod.findMany({
        where: {
          organizationId: input.organizationId,
          unitTypeId: amendment.unitTypeId,
          startsOn: { lt: amendment.targetEndsOn },
          endsOn: { gt: amendment.targetStartsOn },
        },
        orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
        select: { startsOn: true, endsOn: true, dailyRateMinor: true },
      }),
      readSettlementRows(transaction, input),
    ]);
    if (blockOverlap || competingHold || bookingOverlap || overdueCustodyUnitIds.length > 0) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental commercial amendment target dates now conflict with another inventory commitment.',
      );
    }

    const targetPricing = buildRentalPricingEvidence({
      unitTypeId: amendment.unitTypeId,
      currency: currentUnit.unitType.currency,
      startsOn: amendment.targetStartsOn,
      endsOn: amendment.targetEndsOn,
      defaultDailyRateMinor: currentUnit.unitType.defaultDailyRateMinor,
      ratePeriods,
    });
    if (
      targetPricing.currency !== amendment.currency
      || BigInt(targetPricing.totalMinor) !== amendment.afterTotalMinor
      || targetPricing.fingerprint !== amendment.targetPricingFingerprint
    ) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental target pricing changed after commercial amendment settlement. Compensate the adjustment before preparing new authority.',
      );
    }

    const paymentHistory = await readRentalPaymentSettlementHistory({
      transaction,
      organizationId: input.organizationId,
      bookingId: booking.id,
    });
    if (!paymentHistory.complete) {
      throw new RentalBookingCommercialAmendmentConflictError(
        `Original rental booking-price settlement must remain reconciled before commercial amendment apply. ${paymentHistory.reason}`,
      );
    }
    const bookingPriceSettlement = deriveRentalPaymentSettlement({
      bookingTotalMinor: booking.totalMinor,
      currency: booking.currency,
      transactions: paymentHistory.transactions,
    });
    if (
      !bookingPriceSettlement.reconciled
      || bookingPriceSettlement.paymentState !== 'PAID'
      || bookingPriceSettlement.netSettledMinor !== booking.totalMinor
    ) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Original rental booking-price settlement changed after commercial amendment preparation.',
      );
    }

    const settlement = deriveRentalBookingCommercialAmendmentSettlementState({
      direction: amendment.direction,
      currency: amendment.currency,
      deltaMinor: amendment.deltaMinor,
      rows: settlementRows as unknown as readonly RentalBookingCommercialAmendmentSettlementRow[],
    });
    if (settlement.state === 'CONFLICT') {
      throw new RentalBookingCommercialAmendmentConflictError(settlement.reason);
    }
    if (settlement.state !== 'SETTLED') {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental commercial amendment requires one exact uncompensated adjustment settlement before final apply.',
      );
    }

    const appliedAt = authorityClock.now;
    const reschedule = await transaction.rentalBookingReschedule.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey: applyIdempotencyKey(amendment.id),
        sourceStartsOn,
        sourceEndsOn,
        targetStartsOn: amendment.targetStartsOn,
        targetEndsOn: amendment.targetEndsOn,
        currency: amendment.currency,
        totalMinor: amendment.afterTotalMinor,
        sourcePricingFingerprint: amendment.sourcePricingFingerprint,
        targetPricingFingerprint: targetPricing.fingerprint,
        targetPricingSnapshot: toJsonInput(targetPricing.snapshot),
        authorityFingerprint: amendment.reviewFingerprint,
        appliedAt,
      },
    });

    const allocationUpdated = await transaction.rentalBookingAllocation.updateMany({
      where: {
        id: booking.allocation.id,
        organizationId: input.organizationId,
        bookingId: booking.id,
        unitId: amendment.unitId,
        startsOn: amendment.sourceStartsOn,
        endsOn: amendment.sourceEndsOn,
      },
      data: { startsOn: amendment.targetStartsOn, endsOn: amendment.targetEndsOn },
    });
    if (allocationUpdated.count !== 1) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental allocation changed before commercial amendment apply could commit.',
      );
    }

    const bookingVersionUpdated = await transaction.rentalBooking.updateMany({
      where: {
        id: booking.id,
        organizationId: input.organizationId,
        status: 'CONFIRMED',
        cancelledAt: null,
        updatedAt: amendment.bookingVersion,
        currency: booking.currency,
        totalMinor: booking.totalMinor,
        pricingFingerprint: booking.pricingFingerprint,
      },
      data: { updatedAt: appliedAt },
    });
    if (bookingVersionUpdated.count !== 1) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental booking changed before commercial amendment apply could version the effective terms.',
      );
    }

    const amendmentUpdated = await transaction.rentalBookingCommercialAmendment.updateMany({
      where: {
        id: amendment.id,
        organizationId: input.organizationId,
        bookingId: booking.id,
        status: 'PREPARED',
        bookingVersion: amendment.bookingVersion,
        reviewFingerprint: amendment.reviewFingerprint,
        appliedRescheduleId: null,
        appliedAt: null,
      },
      data: {
        status: 'APPLIED',
        appliedRescheduleId: reschedule.id,
        appliedAt,
        endedAt: appliedAt,
      },
    });
    if (amendmentUpdated.count !== 1) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental commercial amendment lifecycle changed before final apply could commit.',
      );
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: amendment.mode === 'CUSTODY_EXTENSION'
          ? 'booking.rental.commercial-amendment-extension.applied'
          : 'booking.rental.commercial-amendment-reschedule.applied',
        resourceType: 'rental-booking',
        resourceId: booking.id,
        beforeData: {
          amendmentId: amendment.id,
          unitId: amendment.unitId,
          startsOn: amendment.sourceStartsOn.toISOString(),
          endsOn: amendment.sourceEndsOn.toISOString(),
          currency: amendment.currency,
          totalMinor: amendment.beforeTotalMinor.toString(),
          pricingFingerprint: amendment.sourcePricingFingerprint,
        },
        afterData: {
          amendmentId: amendment.id,
          rescheduleId: reschedule.id,
          unitId: amendment.unitId,
          startsOn: amendment.targetStartsOn.toISOString(),
          endsOn: amendment.targetEndsOn.toISOString(),
          currency: amendment.currency,
          totalMinor: amendment.afterTotalMinor.toString(),
          deltaMinor: amendment.deltaMinor.toString(),
          direction: amendment.direction,
          pricingFingerprint: amendment.targetPricingFingerprint,
          settlementProviderCode: settlement.adjustment.providerCode,
          appliedAt: appliedAt.toISOString(),
        },
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.commercial-amendment.applied',
        resourceType: 'rental-booking-commercial-amendment',
        resourceId: amendment.id,
        beforeData: { status: 'PREPARED' },
        afterData: {
          bookingId: booking.id,
          status: 'APPLIED',
          rescheduleId: reschedule.id,
          appliedAt: appliedAt.toISOString(),
          targetPricingFingerprint: amendment.targetPricingFingerprint,
        },
      },
    });

    const [currentAmendment, currentBooking, currentAllocation] = await Promise.all([
      transaction.rentalBookingCommercialAmendment.findFirst({
        where: { id: amendment.id, organizationId: input.organizationId, bookingId: booking.id },
      }),
      transaction.rentalBooking.findFirst({
        where: { id: booking.id, organizationId: input.organizationId },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: { bookingId: booking.id, organizationId: input.organizationId },
      }),
    ]);
    if (
      !currentAmendment
      || currentAmendment.status !== 'APPLIED'
      || currentAmendment.appliedRescheduleId !== reschedule.id
      || !currentBooking
      || !currentAllocation
      || currentAllocation.unitId !== amendment.unitId
      || currentAllocation.startsOn.getTime() !== amendment.targetStartsOn.getTime()
      || currentAllocation.endsOn.getTime() !== amendment.targetEndsOn.getTime()
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental commercial amendment apply did not retain complete effective allocation and lifecycle evidence.',
      );
    }

    return Object.freeze({
      amendment: currentAmendment,
      booking: currentBooking,
      allocation: currentAllocation,
      reschedule,
      settlement,
      applied: true as const,
      idempotent: false as const,
    });
  }, { isolationLevel: 'Serializable' }));
}
