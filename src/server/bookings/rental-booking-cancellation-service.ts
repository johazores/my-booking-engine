import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { RentalAvailabilityIntegrityError } from '../inventory/rental-availability-domain.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';

export class RentalBookingCancellationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingCancellationConflictError';
  }
}

export class RentalBookingCancellationUnavailableError extends Error {
  constructor() {
    super('Rental booking is not available in this organization.');
    this.name = 'RentalBookingCancellationUnavailableError';
  }
}

function rentalBookingCancellationLockKey(organizationId: string, bookingId: string) {
  return `sf:rental-booking:${organizationId}:booking:${bookingId}`;
}

function prismaErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

async function runRentalBookingCancellation<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (prismaErrorCode(error) === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }
  throw new RentalBookingCancellationConflictError('Rental booking cancellation could not be serialized.');
}

export async function cancelRentalBooking(input: Readonly<{
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
      permission: 'availability:manage',
    }),
  ]);

  return runRentalBookingCancellation(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalBookingCancellationLockKey(input.organizationId, input.bookingId)}, 0)
      )
    `;

    const locator = await transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { unitId: true },
    });
    if (!locator) throw new RentalBookingCancellationUnavailableError();

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, locator.unitId)}, 0)
      )
    `;

    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError('Database clock is unavailable for rental booking cancellation.');
    }

    const booking = await transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId, unitId: locator.unitId },
      include: { allocation: true },
    });
    if (!booking) throw new RentalBookingCancellationUnavailableError();
    if (
      !booking.allocation
      || booking.allocation.organizationId !== input.organizationId
      || booking.allocation.bookingId !== booking.id
      || booking.allocation.unitId !== booking.unitId
      || booking.allocation.startsOn.getTime() !== booking.startsOn.getTime()
      || booking.allocation.endsOn.getTime() !== booking.endsOn.getTime()
    ) {
      throw new RentalAvailabilityIntegrityError('Rental booking cancellation requires its exact physical-unit allocation.');
    }

    if (booking.status === 'CANCELLED') {
      if (!booking.cancelledAt) {
        throw new RentalAvailabilityIntegrityError('Cancelled rental booking is missing its cancellation timestamp.');
      }
      return Object.freeze({ booking, allocation: booking.allocation, idempotent: true });
    }
    if (booking.status !== 'CONFIRMED' || booking.cancelledAt) {
      throw new RentalBookingCancellationConflictError('Only a confirmed rental booking can be cancelled.');
    }

    const cancelled = await transaction.rentalBooking.updateMany({
      where: {
        id: booking.id,
        organizationId: input.organizationId,
        status: 'CONFIRMED',
        cancelledAt: null,
        updatedAt: booking.updatedAt,
        customerId: booking.customerId,
        customerFirstName: booking.customerFirstName,
        customerLastName: booking.customerLastName,
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
        holdId: booking.holdId,
        unitId: booking.unitId,
        unitTypeId: booking.unitTypeId,
        locationId: booking.locationId,
        idempotencyKey: booking.idempotencyKey,
        startsOn: booking.startsOn,
        endsOn: booking.endsOn,
        currency: booking.currency,
        totalMinor: booking.totalMinor,
        pricingFingerprint: booking.pricingFingerprint,
        pricingObservedAt: booking.pricingObservedAt,
        authorityFingerprint: booking.authorityFingerprint,
        confirmedAt: booking.confirmedAt,
      },
      data: {
        status: 'CANCELLED',
        cancelledAt: databaseClock.now,
      },
    });
    if (cancelled.count !== 1) {
      throw new RentalBookingCancellationConflictError('Rental booking changed before cancellation could be committed.');
    }

    const current = await transaction.rentalBooking.findFirst({
      where: { id: booking.id, organizationId: input.organizationId },
      include: { allocation: true },
    });
    if (!current || current.status !== 'CANCELLED' || !current.cancelledAt || !current.allocation) {
      throw new RentalAvailabilityIntegrityError('Rental booking cancellation did not retain complete lifecycle evidence.');
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.cancelled',
        resourceType: 'rental-booking',
        resourceId: booking.id,
        beforeData: {
          status: booking.status,
          unitId: booking.unitId,
          startsOn: booking.startsOn.toISOString(),
          endsOn: booking.endsOn.toISOString(),
          allocationId: booking.allocation.id,
        },
        afterData: {
          status: current.status,
          cancelledAt: current.cancelledAt.toISOString(),
          allocationId: current.allocation.id,
          inventoryProtectionReleased: true,
        },
      },
    });

    return Object.freeze({ booking: current, allocation: current.allocation, idempotent: false });
  }, { isolationLevel: 'Serializable' }));
}
