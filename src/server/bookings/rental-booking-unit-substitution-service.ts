import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { RentalAvailabilityIntegrityError } from '../inventory/rental-availability-domain.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { rentalBookingLockKey } from './rental-booking-reschedule-domain.ts';
import {
  buildRentalBookingUnitSubstitutionAuthorityFingerprint,
  normalizeRentalBookingUnitSubstitutionApplyInput,
  type RentalBookingUnitSubstitutionApplyInput,
} from './rental-booking-unit-substitution-domain.ts';

export class RentalBookingUnitSubstitutionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingUnitSubstitutionConflictError';
  }
}

export class RentalBookingUnitSubstitutionUnavailableError extends Error {
  constructor() {
    super('Rental booking is not available for physical-unit substitution in this organization.');
    this.name = 'RentalBookingUnitSubstitutionUnavailableError';
  }
}

function prismaErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

async function runRentalBookingUnitSubstitution<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = prismaErrorCode(error);
      if ((code === 'P2002' || code === 'P2034') && attempt < 2) continue;
      if (code === 'P2003' || code === 'P2004') {
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
  for (const unitId of [...new Set(unitIds)].sort()) {
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
          'That rental unit substitution idempotency key was already used for different authority or inventory.',
        );
      }
      const [booking, allocation] = await Promise.all([
        transaction.rentalBooking.findFirst({
          where: { id: input.bookingId, organizationId: input.organizationId },
        }),
        transaction.rentalBookingAllocation.findFirst({
          where: { bookingId: input.bookingId, organizationId: input.organizationId },
        }),
      ]);
      if (!booking || !allocation || allocation.unitId !== existing.targetUnitId) {
        throw new RentalAvailabilityIntegrityError(
          'Applied rental unit substitution is missing its effective allocation evidence.',
        );
      }
      return Object.freeze({ booking, allocation, substitution: existing, idempotent: true });
    }

    const locator = await transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { allocation: { select: { unitId: true } } },
    });
    if (!locator?.allocation) throw new RentalBookingUnitSubstitutionUnavailableError();

    await lockRentalUnits(
      transaction,
      input.organizationId,
      [locator.allocation.unitId, requested.targetUnitId],
    );

    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError(
        'Database clock is unavailable for rental unit substitution.',
      );
    }

    const [booking, latestReschedule, latestSubstitution, targetUnit] = await Promise.all([
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
      transaction.rentalUnit.findFirst({
        where: { id: requested.targetUnitId, organizationId: input.organizationId },
        select: {
          id: true,
          status: true,
          unitTypeId: true,
          locationId: true,
          unitType: { select: { status: true } },
          location: { select: { status: true } },
        },
      }),
    ]);
    if (!booking?.allocation) throw new RentalBookingUnitSubstitutionUnavailableError();

    const effectiveStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const effectiveEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
    const effectivePricingFingerprint =
      latestReschedule?.targetPricingFingerprint ?? booking.pricingFingerprint;
    const expectedSourceUnitId = latestSubstitution?.targetUnitId ?? booking.unitId;

    if (
      booking.allocation.organizationId !== input.organizationId
      || booking.allocation.bookingId !== booking.id
      || booking.allocation.unitId !== expectedSourceUnitId
      || booking.allocation.unitId !== locator.allocation.unitId
      || booking.allocation.startsOn.getTime() !== effectiveStartsOn.getTime()
      || booking.allocation.endsOn.getTime() !== effectiveEndsOn.getTime()
      || booking.allocation.unit.id !== booking.allocation.unitId
      || booking.allocation.unit.status !== 'ACTIVE'
      || booking.allocation.unit.unitTypeId !== booking.unitTypeId
      || booking.allocation.unit.locationId !== booking.locationId
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental unit substitution requires the exact effective physical-unit allocation.',
      );
    }
    if (
      !targetUnit
      || targetUnit.id === booking.allocation.unitId
      || targetUnit.status !== 'ACTIVE'
      || targetUnit.unitType.status !== 'ACTIVE'
      || !targetUnit.location
      || targetUnit.location.status !== 'ACTIVE'
      || targetUnit.unitTypeId !== booking.unitTypeId
      || targetUnit.locationId !== booking.locationId
    ) {
      throw new RentalBookingUnitSubstitutionConflictError(
        'Target physical unit must be a different active unit of the same booked unit type and operating location.',
      );
    }

    const [blockOverlap, competingHold, bookingOverlap] = await Promise.all([
      transaction.rentalAvailabilityBlock.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: targetUnit.id,
          startsOn: { lt: effectiveEndsOn },
          endsOn: { gt: effectiveStartsOn },
        },
        select: { id: true },
      }),
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: targetUnit.id,
          status: 'ACTIVE',
          expiresAt: { gt: databaseClock.now },
          startsOn: { lt: effectiveEndsOn },
          endsOn: { gt: effectiveStartsOn },
        },
        select: { id: true },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: targetUnit.id,
          bookingId: { not: booking.id },
          startsOn: { lt: effectiveEndsOn },
          endsOn: { gt: effectiveStartsOn },
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
        'Target physical unit now conflicts with another inventory commitment.',
      );
    }

    const expectedAuthorityFingerprint = buildRentalBookingUnitSubstitutionAuthorityFingerprint({
      organizationId: input.organizationId,
      bookingId: booking.id,
      bookingUpdatedAt: booking.updatedAt,
      sourceUnitId: booking.allocation.unitId,
      targetUnitId: targetUnit.id,
      unitTypeId: booking.unitTypeId,
      locationId: booking.locationId,
      startsOn: effectiveStartsOn,
      endsOn: effectiveEndsOn,
      currency: booking.currency,
      totalMinor: booking.totalMinor,
      pricingFingerprint: effectivePricingFingerprint,
    });
    if (requested.authorityFingerprint !== expectedAuthorityFingerprint) {
      throw new RentalBookingUnitSubstitutionConflictError(
        'Rental unit substitution authority changed. Review the target unit again before applying.',
      );
    }

    const substitution = await transaction.rentalBookingUnitSubstitution.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey: requested.idempotencyKey,
        sourceUnitId: booking.allocation.unitId,
        targetUnitId: targetUnit.id,
        unitTypeId: booking.unitTypeId,
        locationId: booking.locationId,
        startsOn: effectiveStartsOn,
        endsOn: effectiveEndsOn,
        currency: booking.currency,
        totalMinor: booking.totalMinor,
        pricingFingerprint: effectivePricingFingerprint,
        authorityFingerprint: expectedAuthorityFingerprint,
        appliedAt: databaseClock.now,
      },
    });

    const allocationUpdated = await transaction.rentalBookingAllocation.updateMany({
      where: {
        id: booking.allocation.id,
        organizationId: input.organizationId,
        bookingId: booking.id,
        unitId: booking.allocation.unitId,
        startsOn: effectiveStartsOn,
        endsOn: effectiveEndsOn,
      },
      data: { unitId: targetUnit.id },
    });
    if (allocationUpdated.count !== 1) {
      throw new RentalBookingUnitSubstitutionConflictError(
        'Rental allocation changed before the unit substitution could be committed.',
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
        'Rental booking changed before the unit substitution version could be committed.',
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
          unitId: booking.allocation.unitId,
          startsOn: effectiveStartsOn.toISOString(),
          endsOn: effectiveEndsOn.toISOString(),
          pricingFingerprint: effectivePricingFingerprint,
        },
        afterData: {
          substitutionId: substitution.id,
          unitId: targetUnit.id,
          startsOn: effectiveStartsOn.toISOString(),
          endsOn: effectiveEndsOn.toISOString(),
          pricingFingerprint: effectivePricingFingerprint,
          authorityFingerprint: expectedAuthorityFingerprint,
        },
      },
    });

    const [currentBooking, currentAllocation] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: { id: booking.id, organizationId: input.organizationId },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: { bookingId: booking.id, organizationId: input.organizationId },
      }),
    ]);
    if (
      !currentBooking
      || currentBooking.status !== 'CONFIRMED'
      || !currentAllocation
      || currentAllocation.unitId !== targetUnit.id
      || currentAllocation.startsOn.getTime() !== effectiveStartsOn.getTime()
      || currentAllocation.endsOn.getTime() !== effectiveEndsOn.getTime()
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
