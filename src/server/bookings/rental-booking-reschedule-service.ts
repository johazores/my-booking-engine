import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import {
  buildRentalPricingEvidence,
  RentalAvailabilityIntegrityError,
} from '../inventory/rental-availability-domain.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  buildRentalBookingRescheduleAuthorityFingerprint,
  normalizeRentalBookingRescheduleApplyInput,
  rentalBookingLockKey,
  type RentalBookingRescheduleApplyInput,
} from './rental-booking-reschedule-domain.ts';
import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';

export class RentalBookingRescheduleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingRescheduleConflictError';
  }
}

export class RentalBookingRescheduleUnavailableError extends Error {
  constructor() {
    super('Rental booking is not available for rescheduling in this organization.');
    this.name = 'RentalBookingRescheduleUnavailableError';
  }
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function runRentalBookingReschedule<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE') {
        throw new RentalBookingRescheduleConflictError(
          'Rental booking reschedule could not be serialized after bounded retries.',
        );
      }
      if (disposition === 'CONFLICT') {
        throw new RentalBookingRescheduleConflictError(
          'Rental booking reschedule no longer satisfies the durable inventory or lifecycle contract.',
        );
      }
      throw error;
    }
  }
  throw new RentalBookingRescheduleConflictError('Rental booking reschedule could not be serialized.');
}

export async function applyRentalBookingReschedule(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  reschedule: RentalBookingRescheduleApplyInput;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const requested = normalizeRentalBookingRescheduleApplyInput(input.reschedule);

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' }),
  ]);

  return runRentalBookingReschedule(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0)
      )
    `;

    const existing = await transaction.rentalBookingReschedule.findFirst({
      where: { organizationId: input.organizationId, idempotencyKey: requested.idempotencyKey },
    });
    if (existing) {
      if (
        existing.bookingId !== input.bookingId
        || existing.targetStartsOn.getTime() !== requested.startsOn.getTime()
        || existing.targetEndsOn.getTime() !== requested.endsOn.getTime()
        || existing.authorityFingerprint !== requested.authorityFingerprint
      ) {
        throw new RentalBookingRescheduleConflictError(
          'That rental reschedule idempotency key was already used for different authority or target dates.',
        );
      }
      const [booking, allocation, latestReschedule] = await Promise.all([
        transaction.rentalBooking.findFirst({ where: { id: input.bookingId, organizationId: input.organizationId } }),
        transaction.rentalBookingAllocation.findFirst({ where: { bookingId: input.bookingId, organizationId: input.organizationId } }),
        transaction.rentalBookingReschedule.findFirst({
          where: { bookingId: input.bookingId, organizationId: input.organizationId },
          orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        }),
      ]);
      if (!booking || !allocation || !latestReschedule || latestReschedule.id !== existing.id) {
        throw new RentalBookingRescheduleConflictError(
          'That reschedule was applied previously but is no longer the current effective rental period.',
        );
      }
      return Object.freeze({ booking, allocation, reschedule: existing, idempotent: true });
    }

    const [bookingLocator, allocationLocator, latestSubstitutionLocator] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: {
          id: input.bookingId,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
          cancelledAt: null,
          fulfillmentEvents: { none: { organizationId: input.organizationId } },
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
    if (!bookingLocator || !allocationLocator) throw new RentalBookingRescheduleUnavailableError();
    const effectiveUnitId = latestSubstitutionLocator?.targetUnitId ?? bookingLocator.unitId;
    if (allocationLocator.unitId !== effectiveUnitId) {
      throw new RentalAvailabilityIntegrityError(
        'Rental reschedule locator does not match the current effective unit assignment.',
      );
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, effectiveUnitId)}, 0)
      )
    `;

    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError('Database clock is unavailable for rental booking rescheduling.');
    }

    const [booking, latestReschedule, latestSubstitution] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: {
          id: input.bookingId,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
          cancelledAt: null,
          fulfillmentEvents: { none: { organizationId: input.organizationId } },
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
    if (!booking) throw new RentalBookingRescheduleUnavailableError();
    if (!booking.allocation) {
      throw new RentalAvailabilityIntegrityError('Rental booking reschedule requires its retained physical-unit allocation.');
    }

    const sourceStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const sourceEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
    const sourcePricingFingerprint = latestReschedule?.targetPricingFingerprint ?? booking.pricingFingerprint;
    const currentUnitId = latestSubstitution?.targetUnitId ?? booking.unitId;
    const currentUnit = booking.allocation.unit;
    if (
      currentUnitId !== effectiveUnitId
      || booking.allocation.organizationId !== input.organizationId
      || booking.allocation.bookingId !== booking.id
      || booking.allocation.unitId !== currentUnitId
      || currentUnit.id !== currentUnitId
      || booking.allocation.startsOn.getTime() !== sourceStartsOn.getTime()
      || booking.allocation.endsOn.getTime() !== sourceEndsOn.getTime()
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental booking reschedule requires the exact effective physical-unit allocation.',
      );
    }
    if (
      currentUnit.status !== 'ACTIVE'
      || currentUnit.unitType.status !== 'ACTIVE'
      || !currentUnit.location
      || currentUnit.location.status !== 'ACTIVE'
      || currentUnit.unitTypeId !== booking.unitTypeId
      || currentUnit.unitType.id !== booking.unitTypeId
      || currentUnit.locationId !== booking.locationId
      || currentUnit.location.id !== booking.locationId
    ) {
      throw new RentalBookingRescheduleConflictError(
        'The effective physical unit is no longer active at its retained operating assignment.',
      );
    }
    if (
      requested.startsOn.getTime() === sourceStartsOn.getTime()
      && requested.endsOn.getTime() === sourceEndsOn.getTime()
    ) {
      throw new RentalBookingRescheduleConflictError('Rental booking target dates must change.');
    }

    const [blockOverlap, competingHold, bookingOverlap, ratePeriods] = await Promise.all([
      transaction.rentalAvailabilityBlock.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: currentUnitId,
          startsOn: { lt: requested.endsOn },
          endsOn: { gt: requested.startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: currentUnitId,
          status: 'ACTIVE',
          expiresAt: { gt: databaseClock.now },
          startsOn: { lt: requested.endsOn },
          endsOn: { gt: requested.startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: currentUnitId,
          bookingId: { not: booking.id },
          startsOn: { lt: requested.endsOn },
          endsOn: { gt: requested.startsOn },
          booking: { is: { organizationId: input.organizationId, status: { not: 'CANCELLED' } } },
        },
        select: { id: true },
      }),
      transaction.rentalRatePeriod.findMany({
        where: {
          organizationId: input.organizationId,
          unitTypeId: booking.unitTypeId,
          startsOn: { lt: requested.endsOn },
          endsOn: { gt: requested.startsOn },
        },
        orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
        select: { startsOn: true, endsOn: true, dailyRateMinor: true },
      }),
    ]);
    if (blockOverlap || competingHold || bookingOverlap) {
      throw new RentalBookingRescheduleConflictError(
        'The target rental dates now conflict with another inventory commitment.',
      );
    }

    const targetPricing = buildRentalPricingEvidence({
      unitTypeId: booking.unitTypeId,
      currency: currentUnit.unitType.currency,
      startsOn: requested.startsOn,
      endsOn: requested.endsOn,
      defaultDailyRateMinor: currentUnit.unitType.defaultDailyRateMinor,
      ratePeriods,
    });
    if (targetPricing.currency !== booking.currency || BigInt(targetPricing.totalMinor) !== booking.totalMinor) {
      throw new RentalBookingRescheduleConflictError(
        'Current target-date pricing changes the accepted rental amount. Run a new review; price-changing amendments are not supported.',
      );
    }

    const expectedAuthorityFingerprint = buildRentalBookingRescheduleAuthorityFingerprint({
      organizationId: input.organizationId,
      bookingId: booking.id,
      bookingUpdatedAt: booking.updatedAt,
      unitId: currentUnitId,
      unitTypeId: booking.unitTypeId,
      locationId: booking.locationId,
      sourceStartsOn,
      sourceEndsOn,
      targetStartsOn: requested.startsOn,
      targetEndsOn: requested.endsOn,
      currency: targetPricing.currency,
      totalMinor: BigInt(targetPricing.totalMinor),
      sourcePricingFingerprint,
      targetPricingFingerprint: targetPricing.fingerprint,
    });
    if (requested.authorityFingerprint !== expectedAuthorityFingerprint) {
      throw new RentalBookingRescheduleConflictError(
        'Rental reschedule authority changed. Review the target dates again before applying.',
      );
    }

    const reschedule = await transaction.rentalBookingReschedule.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey: requested.idempotencyKey,
        sourceStartsOn,
        sourceEndsOn,
        targetStartsOn: requested.startsOn,
        targetEndsOn: requested.endsOn,
        currency: booking.currency,
        totalMinor: booking.totalMinor,
        sourcePricingFingerprint,
        targetPricingFingerprint: targetPricing.fingerprint,
        targetPricingSnapshot: toJsonInput(targetPricing.snapshot),
        authorityFingerprint: expectedAuthorityFingerprint,
        appliedAt: databaseClock.now,
      },
    });

    const allocationUpdated = await transaction.rentalBookingAllocation.updateMany({
      where: {
        id: booking.allocation.id,
        organizationId: input.organizationId,
        bookingId: booking.id,
        unitId: currentUnitId,
        startsOn: sourceStartsOn,
        endsOn: sourceEndsOn,
      },
      data: { startsOn: requested.startsOn, endsOn: requested.endsOn },
    });
    if (allocationUpdated.count !== 1) {
      throw new RentalBookingRescheduleConflictError(
        'Rental allocation changed before the reschedule could be committed.',
      );
    }

    const bookingVersionUpdated = await transaction.rentalBooking.updateMany({
      where: {
        id: booking.id,
        organizationId: input.organizationId,
        status: 'CONFIRMED',
        cancelledAt: null,
        updatedAt: booking.updatedAt,
        customerId: booking.customerId,
        holdId: booking.holdId,
        unitId: booking.unitId,
        unitTypeId: booking.unitTypeId,
        locationId: booking.locationId,
        startsOn: booking.startsOn,
        endsOn: booking.endsOn,
        currency: booking.currency,
        totalMinor: booking.totalMinor,
        pricingFingerprint: booking.pricingFingerprint,
        authorityFingerprint: booking.authorityFingerprint,
        confirmedAt: booking.confirmedAt,
      },
      data: { updatedAt: databaseClock.now },
    });
    if (bookingVersionUpdated.count !== 1) {
      throw new RentalBookingRescheduleConflictError(
        'Rental booking changed before the reschedule version could be committed.',
      );
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.rescheduled',
        resourceType: 'rental-booking',
        resourceId: booking.id,
        beforeData: {
          unitId: currentUnitId,
          startsOn: sourceStartsOn.toISOString(),
          endsOn: sourceEndsOn.toISOString(),
          pricingFingerprint: sourcePricingFingerprint,
        },
        afterData: {
          rescheduleId: reschedule.id,
          unitId: currentUnitId,
          startsOn: requested.startsOn.toISOString(),
          endsOn: requested.endsOn.toISOString(),
          pricingFingerprint: targetPricing.fingerprint,
          authorityFingerprint: expectedAuthorityFingerprint,
        },
      },
    });

    const [currentBooking, currentAllocation] = await Promise.all([
      transaction.rentalBooking.findFirst({ where: { id: booking.id, organizationId: input.organizationId } }),
      transaction.rentalBookingAllocation.findFirst({ where: { bookingId: booking.id, organizationId: input.organizationId } }),
    ]);
    if (
      !currentBooking
      || currentBooking.status !== 'CONFIRMED'
      || !currentAllocation
      || currentAllocation.unitId !== currentUnitId
      || currentAllocation.startsOn.getTime() !== requested.startsOn.getTime()
      || currentAllocation.endsOn.getTime() !== requested.endsOn.getTime()
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental reschedule did not retain complete effective allocation evidence.',
      );
    }

    return Object.freeze({ booking: currentBooking, allocation: currentAllocation, reschedule, idempotent: false });
  }, { isolationLevel: 'Serializable' }));
}
