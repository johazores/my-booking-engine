import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { RentalAvailabilityIntegrityError } from '../inventory/rental-availability-domain.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  deriveRentalBookingEarlyReturnReleaseEndsOn,
  rentalBookingEarlyReturnReleaseIdempotencyKey,
} from './rental-booking-early-return-release-domain.ts';
import { deriveRentalBookingFulfillmentState } from './rental-booking-fulfillment-domain.ts';
import { rentalBookingLockKey } from './rental-booking-reschedule-domain.ts';
import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';

export class RentalBookingEarlyReturnReleaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingEarlyReturnReleaseConflictError';
  }
}

export class RentalBookingEarlyReturnReleaseUnavailableError extends Error {
  constructor() {
    super('Rental booking is not available for early-return inventory release in this organization.');
    this.name = 'RentalBookingEarlyReturnReleaseUnavailableError';
  }
}

async function runRentalBookingEarlyReturnRelease<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE') {
        throw new RentalBookingEarlyReturnReleaseConflictError(
          'Early-return inventory release could not be serialized after bounded retries.',
        );
      }
      if (disposition === 'CONFLICT') {
        throw new RentalBookingEarlyReturnReleaseConflictError(
          'Early-return inventory release no longer satisfies the durable booking or inventory contract.',
        );
      }
      throw error;
    }
  }
  throw new RentalBookingEarlyReturnReleaseConflictError(
    'Early-return inventory release could not be serialized.',
  );
}

function sameDate(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

export async function releaseRentalBookingInventoryAfterEarlyReturn(input: Readonly<{
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
      permission: 'booking:manage',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'inventory:manage',
    }),
  ]);

  const idempotencyKey = rentalBookingEarlyReturnReleaseIdempotencyKey(input.bookingId);

  return runRentalBookingEarlyReturnRelease(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0)
      )
    `;

    const existing = await transaction.rentalBookingEarlyReturnRelease.findFirst({
      where: { organizationId: input.organizationId, bookingId: input.bookingId },
    });
    if (existing) {
      if (existing.idempotencyKey !== idempotencyKey) {
        throw new RentalBookingEarlyReturnReleaseConflictError(
          'Existing early-return release evidence does not match server-derived idempotency authority.',
        );
      }

      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${rentalUnitLockKey(input.organizationId, existing.unitId)}, 0)
        )
      `;

      const allocation = await transaction.rentalBookingAllocation.findFirst({
        where: { organizationId: input.organizationId, bookingId: input.bookingId },
      });
      if (
        !allocation
        || allocation.unitId !== existing.unitId
        || !sameDate(allocation.startsOn, existing.committedStartsOn)
        || !sameDate(allocation.endsOn, existing.releasedEndsOn)
      ) {
        throw new RentalBookingEarlyReturnReleaseConflictError(
          'Existing early-return release evidence no longer matches the live physical allocation.',
        );
      }

      return Object.freeze({ release: existing, idempotent: true });
    }

    const [booking, latestReschedule, latestSubstitution] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: {
          id: input.bookingId,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
          cancelledAt: null,
        },
        select: {
          id: true,
          unitId: true,
          unitTypeId: true,
          locationId: true,
          startsOn: true,
          endsOn: true,
          location: { select: { timeZone: true } },
        },
      }),
      transaction.rentalBookingReschedule.findFirst({
        where: { organizationId: input.organizationId, bookingId: input.bookingId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: { targetStartsOn: true, targetEndsOn: true },
      }),
      transaction.rentalBookingUnitSubstitution.findFirst({
        where: { organizationId: input.organizationId, bookingId: input.bookingId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: { targetUnitId: true },
      }),
    ]);

    if (!booking) throw new RentalBookingEarlyReturnReleaseUnavailableError();

    const effectiveUnitId = latestSubstitution?.targetUnitId ?? booking.unitId;
    const committedStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const committedEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, effectiveUnitId)}, 0)
      )
    `;

    const [allocation, history, unit, databaseClock] = await Promise.all([
      transaction.rentalBookingAllocation.findFirst({
        where: { organizationId: input.organizationId, bookingId: booking.id },
      }),
      transaction.rentalBookingFulfillmentEvent.findMany({
        where: { organizationId: input.organizationId, bookingId: booking.id },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      transaction.rentalUnit.findFirst({
        where: {
          id: effectiveUnitId,
          organizationId: input.organizationId,
          unitTypeId: booking.unitTypeId,
          locationId: booking.locationId,
          status: 'ACTIVE',
        },
        select: { id: true, code: true, name: true },
      }),
      transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`,
    ]);

    if (
      !allocation
      || allocation.unitId !== effectiveUnitId
      || !sameDate(allocation.startsOn, committedStartsOn)
      || !sameDate(allocation.endsOn, committedEndsOn)
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Early-return inventory release requires the exact current committed physical allocation.',
      );
    }
    if (!unit) {
      throw new RentalBookingEarlyReturnReleaseConflictError(
        'The effective rental unit is no longer active at the retained booking assignment.',
      );
    }
    if (!databaseClock[0]?.now) {
      throw new RentalAvailabilityIntegrityError(
        'Database clock is unavailable for early-return inventory release.',
      );
    }

    const fulfillment = deriveRentalBookingFulfillmentState(history);
    if (fulfillment.state !== 'RETURNED') {
      throw new RentalBookingEarlyReturnReleaseConflictError(
        'Early-return inventory release requires recorded pickup and return custody evidence.',
      );
    }

    const returnEvent = history.find((event) => event.kind === 'RETURNED');
    if (
      !returnEvent
      || returnEvent.unitId !== effectiveUnitId
      || !sameDate(returnEvent.startsOn, committedStartsOn)
      || !sameDate(returnEvent.endsOn, committedEndsOn)
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Return custody evidence does not match the current committed rental assignment.',
      );
    }

    const releasedEndsOn = deriveRentalBookingEarlyReturnReleaseEndsOn({
      returnedAt: returnEvent.occurredAt,
      committedStartsOn,
      committedEndsOn,
      timeZone: booking.location.timeZone,
    });
    if (!releasedEndsOn) {
      throw new RentalBookingEarlyReturnReleaseConflictError(
        'The recorded return does not leave a complete remaining rental day to release.',
      );
    }

    const release = await transaction.rentalBookingEarlyReturnRelease.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        unitId: effectiveUnitId,
        returnEventId: returnEvent.id,
        idempotencyKey,
        committedStartsOn,
        committedEndsOn,
        releasedEndsOn,
        returnedAt: returnEvent.occurredAt,
        releasedAt: databaseClock[0].now,
      },
    });

    const allocationUpdate = await transaction.rentalBookingAllocation.updateMany({
      where: {
        id: allocation.id,
        organizationId: input.organizationId,
        bookingId: booking.id,
        unitId: effectiveUnitId,
        startsOn: committedStartsOn,
        endsOn: committedEndsOn,
      },
      data: { endsOn: releasedEndsOn },
    });
    if (allocationUpdate.count !== 1) {
      throw new RentalBookingEarlyReturnReleaseConflictError(
        'The rental allocation changed before early-return inventory could be released.',
      );
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.inventory-released-early',
        resourceType: 'rental-booking',
        resourceId: booking.id,
        beforeData: {
          fulfillmentState: fulfillment.state,
          unitId: effectiveUnitId,
          committedStartsOn: committedStartsOn.toISOString(),
          committedEndsOn: committedEndsOn.toISOString(),
          returnEventId: returnEvent.id,
          returnedAt: returnEvent.occurredAt.toISOString(),
        },
        afterData: {
          earlyReturnReleaseId: release.id,
          inventoryStartsOn: committedStartsOn.toISOString(),
          inventoryEndsOn: releasedEndsOn.toISOString(),
          releasedAt: release.releasedAt.toISOString(),
        },
      },
    });

    return Object.freeze({ release, idempotent: false });
  }, { isolationLevel: 'Serializable' }));
}
