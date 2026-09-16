import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { RentalAvailabilityIntegrityError } from '../inventory/rental-availability-domain.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveRentalBookingPickupWindow } from './rental-booking-pickup-window-domain.ts';
import { rentalBookingLockKey } from './rental-booking-reschedule-domain.ts';
import {
  buildRentalBookingUnitSubstitutionAuthorityFingerprint,
  normalizeRentalBookingUnitSubstitutionApplyInput,
  type RentalBookingUnitSubstitutionApplyInput,
} from './rental-booking-unit-substitution-domain.ts';
import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';

export class RentalBookingUnitSubstitutionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingUnitSubstitutionConflictError';
  }
}

export class RentalBookingUnitSubstitutionUnavailableError extends Error {
  constructor(message = 'Rental booking is not available for physical-unit substitution in this organization.') {
    super(message);
    this.name = 'RentalBookingUnitSubstitutionUnavailableError';
  }
}

async function runRentalBookingUnitSubstitution<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE') {
        throw new RentalBookingUnitSubstitutionConflictError(
          'Rental unit substitution could not be serialized after bounded retries.',
        );
      }
      if (disposition === 'CONFLICT') {
        throw new RentalBookingUnitSubstitutionConflictError(
          'Rental unit substitution no longer satisfies the durable inventory or lifecycle contract.',
        );
      }
      throw error;
    }
  }
  throw new RentalBookingUnitSubstitutionConflictError(
    'Rental unit substitution could not be serialized.',
  );
}

async function lockRentalUnits(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  unitIds: readonly string[],
) {
  const ordered = [...new Set(unitIds)].sort((left, right) => left.localeCompare(right));
  for (const unitId of ordered) {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(organizationId, unitId)}, 0)
      )
    `;
  }
}

export async function applyRentalBookingUnitSubstitution(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  substitution: RentalBookingUnitSubstitutionApplyInput;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const requested = normalizeRentalBookingUnitSubstitutionApplyInput(input.substitution);
  assertUuidIdentifier(requested.targetUnitId, 'targetUnitId');

  await Promise.all([
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'booking:manage',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'availability:read',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'availability:manage',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'inventory:read',
    }),
  ]);

  return runRentalBookingUnitSubstitution(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0)
      )
    `;

    const existing = await transaction.rentalBookingUnitSubstitution.findFirst({
      where: {
        organizationId: input.organizationId,
        idempotencyKey: requested.idempotencyKey,
      },
    });
    if (existing) {
      if (
        existing.bookingId !== input.bookingId
        || existing.targetUnitId !== requested.targetUnitId
        || existing.authorityFingerprint !== requested.authorityFingerprint
      ) {
        throw new RentalBookingUnitSubstitutionConflictError(
          'That rental unit substitution idempotency key was already used for different authority or target inventory.',
        );
      }

      const [booking, allocation, latestSubstitution] = await Promise.all([
        transaction.rentalBooking.findFirst({
          where: { id: input.bookingId, organizationId: input.organizationId },
        }),
        transaction.rentalBookingAllocation.findFirst({
          where: { bookingId: input.bookingId, organizationId: input.organizationId },
        }),
        transaction.rentalBookingUnitSubstitution.findFirst({
          where: { bookingId: input.bookingId, organizationId: input.organizationId },
          orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        }),
      ]);
      if (
        !booking
        || !allocation
        || !latestSubstitution
        || latestSubstitution.id !== existing.id
        || allocation.unitId !== existing.targetUnitId
      ) {
        throw new RentalBookingUnitSubstitutionConflictError(
          'That substitution was applied previously but is no longer the current physical-unit assignment.',
        );
      }
      return Object.freeze({ booking, allocation, substitution: existing, idempotent: true });
    }

    const [bookingLocator, allocationLocator] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: {
          id: input.bookingId,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
          cancelledAt: null,
          fulfillmentEvents: { none: { organizationId: input.organizationId } },
        },
        select: { id: true },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: { bookingId: input.bookingId, organizationId: input.organizationId },
        select: { unitId: true },
      }),
    ]);
    if (!bookingLocator || !allocationLocator) {
      throw new RentalBookingUnitSubstitutionUnavailableError();
    }
    if (allocationLocator.unitId === requested.targetUnitId) {
      throw new RentalBookingUnitSubstitutionConflictError(
        'The requested replacement unit is already the effective physical unit.',
      );
    }

    await lockRentalUnits(transaction, input.organizationId, [
      allocationLocator.unitId,
      requested.targetUnitId,
    ]);

    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError(
        'Database clock is unavailable for rental unit substitution.',
      );
    }

    const [booking, latestReschedule, latestSubstitution, sourceUnit, targetUnit] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: {
          id: input.bookingId,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
          cancelledAt: null,
          fulfillmentEvents: { none: { organizationId: input.organizationId } },
        },
        include: {
          allocation: true,
          location: { select: { id: true, timeZone: true } },
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
      transaction.rentalUnit.findFirst({
        where: {
          id: allocationLocator.unitId,
          organizationId: input.organizationId,
          status: 'ACTIVE',
        },
        include: {
          unitType: { select: { id: true, status: true } },
          location: { select: { id: true, status: true } },
        },
      }),
      transaction.rentalUnit.findFirst({
        where: {
          id: requested.targetUnitId,
          organizationId: input.organizationId,
          status: 'ACTIVE',
        },
        include: {
          unitType: { select: { id: true, status: true } },
          location: { select: { id: true, status: true } },
        },
      }),
    ]);
    if (!booking) throw new RentalBookingUnitSubstitutionUnavailableError();
    if (!booking.allocation) {
      throw new RentalAvailabilityIntegrityError(
        'Rental unit substitution requires its retained physical-unit allocation.',
      );
    }

    const sourceUnitId = latestSubstitution?.targetUnitId ?? booking.unitId;
    const startsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const endsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
    const pricingFingerprint = latestReschedule?.targetPricingFingerprint ?? booking.pricingFingerprint;
    const pickupWindow = deriveRentalBookingPickupWindow({
      observedAt: databaseClock.now,
      startsOn,
      endsOn,
      timeZone: booking.location.timeZone,
    });
    if (pickupWindow.state === 'CLOSED') {
      throw new RentalBookingUnitSubstitutionConflictError(
        'The committed rental pickup window closed before the replacement unit could be applied. Reschedule or cancel the booking before changing its physical unit.',
      );
    }

    if (
      allocationLocator.unitId !== sourceUnitId
      || booking.allocation.organizationId !== input.organizationId
      || booking.allocation.bookingId !== booking.id
      || booking.allocation.unitId !== sourceUnitId
      || booking.allocation.startsOn.getTime() !== startsOn.getTime()
      || booking.allocation.endsOn.getTime() !== endsOn.getTime()
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental unit substitution requires the exact current physical-unit allocation.',
      );
    }

    const unitMatchesBooking = (unit: typeof sourceUnit) => Boolean(
      unit
      && unit.unitType.status === 'ACTIVE'
      && unit.location
      && unit.location.status === 'ACTIVE'
      && unit.unitTypeId === booking.unitTypeId
      && unit.unitType.id === booking.unitTypeId
      && unit.locationId === booking.locationId
      && unit.location.id === booking.locationId
    );
    if (!unitMatchesBooking(sourceUnit)) {
      throw new RentalBookingUnitSubstitutionConflictError(
        'The effective source unit is no longer active at the retained booking assignment.',
      );
    }
    if (!unitMatchesBooking(targetUnit)) {
      throw new RentalBookingUnitSubstitutionConflictError(
        'The replacement unit is no longer an active same-type unit at the retained booking location.',
      );
    }
    if (requested.targetUnitId === sourceUnitId) {
      throw new RentalBookingUnitSubstitutionConflictError(
        'The replacement unit must differ from the current effective unit.',
      );
    }

    const [blockOverlap, competingHold, bookingOverlap] = await Promise.all([
      transaction.rentalAvailabilityBlock.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: requested.targetUnitId,
          startsOn: { lt: endsOn },
          endsOn: { gt: startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: requested.targetUnitId,
          status: 'ACTIVE',
          expiresAt: { gt: databaseClock.now },
          startsOn: { lt: endsOn },
          endsOn: { gt: startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: requested.targetUnitId,
          bookingId: { not: booking.id },
          startsOn: { lt: endsOn },
          endsOn: { gt: startsOn },
          booking: {
            is: {
              organizationId: input.organizationId,
              status: { not: 'CANCELLED' },
            },
          },
        },
        select: { id: true },
      }),
    ]);
    if (blockOverlap || competingHold || bookingOverlap) {
      throw new RentalBookingUnitSubstitutionConflictError(
        'The replacement unit now conflicts with another inventory commitment.',
      );
    }

    const expectedAuthorityFingerprint = buildRentalBookingUnitSubstitutionAuthorityFingerprint({
      organizationId: input.organizationId,
      bookingId: booking.id,
      bookingUpdatedAt: booking.updatedAt,
      sourceUnitId,
      targetUnitId: requested.targetUnitId,
      unitTypeId: booking.unitTypeId,
      locationId: booking.locationId,
      startsOn,
      endsOn,
      currency: booking.currency,
      totalMinor: booking.totalMinor,
      pricingFingerprint,
    });
    if (requested.authorityFingerprint !== expectedAuthorityFingerprint) {
      throw new RentalBookingUnitSubstitutionConflictError(
        'Rental unit substitution authority changed. Review the replacement unit again before applying.',
      );
    }

    const substitution = await transaction.rentalBookingUnitSubstitution.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        sourceUnitId,
        targetUnitId: requested.targetUnitId,
        idempotencyKey: requested.idempotencyKey,
        startsOn,
        endsOn,
        currency: booking.currency,
        totalMinor: booking.totalMinor,
        pricingFingerprint,
        authorityFingerprint: expectedAuthorityFingerprint,
        appliedAt: databaseClock.now,
      },
    });

    const allocationUpdated = await transaction.rentalBookingAllocation.updateMany({
      where: {
        id: booking.allocation.id,
        organizationId: input.organizationId,
        bookingId: booking.id,
        unitId: sourceUnitId,
        startsOn,
        endsOn,
      },
      data: { unitId: requested.targetUnitId },
    });
    if (allocationUpdated.count !== 1) {
      throw new RentalBookingUnitSubstitutionConflictError(
        'Rental allocation changed before the replacement unit could be committed.',
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
      throw new RentalBookingUnitSubstitutionConflictError(
        'Rental booking changed before the substitution version could be committed.',
      );
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.unit-substituted',
        resourceType: 'rental-booking',
        resourceId: booking.id,
        beforeData: {
          unitId: sourceUnitId,
          startsOn: startsOn.toISOString(),
          endsOn: endsOn.toISOString(),
        },
        afterData: {
          substitutionId: substitution.id,
          unitId: requested.targetUnitId,
          startsOn: startsOn.toISOString(),
          endsOn: endsOn.toISOString(),
          authorityFingerprint: expectedAuthorityFingerprint,
        },
      },
    });

    const [currentBooking, currentAllocation, currentSubstitution] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: { id: booking.id, organizationId: input.organizationId },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: { bookingId: booking.id, organizationId: input.organizationId },
      }),
      transaction.rentalBookingUnitSubstitution.findFirst({
        where: { bookingId: booking.id, organizationId: input.organizationId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    if (
      !currentBooking
      || currentBooking.status !== 'CONFIRMED'
      || !currentAllocation
      || currentAllocation.unitId !== requested.targetUnitId
      || currentAllocation.startsOn.getTime() !== startsOn.getTime()
      || currentAllocation.endsOn.getTime() !== endsOn.getTime()
      || !currentSubstitution
      || currentSubstitution.id !== substitution.id
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental unit substitution did not retain complete effective allocation evidence.',
      );
    }

    return Object.freeze({
      booking: currentBooking,
      allocation: currentAllocation,
      substitution,
      idempotent: false,
    });
  }, { isolationLevel: 'Serializable' }));
}
