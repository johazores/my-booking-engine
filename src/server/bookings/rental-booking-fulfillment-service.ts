import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { RentalAvailabilityIntegrityError } from '../inventory/rental-availability-domain.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  deriveRentalBookingFulfillmentState,
  rentalBookingFulfillmentIdempotencyKey,
  type RentalBookingFulfillmentEventKind,
} from './rental-booking-fulfillment-domain.ts';
import { deriveRentalBookingPickupWindow } from './rental-booking-pickup-window-domain.ts';
import { rentalBookingLockKey } from './rental-booking-reschedule-domain.ts';
import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';

export class RentalBookingFulfillmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingFulfillmentConflictError';
  }
}

export class RentalBookingFulfillmentUnavailableError extends Error {
  constructor() {
    super('Rental booking is not available for fulfillment in this organization.');
    this.name = 'RentalBookingFulfillmentUnavailableError';
  }
}

export class RentalBookingPickupWindowConflictError extends RentalBookingFulfillmentConflictError {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingPickupWindowConflictError';
  }
}

async function runRentalBookingFulfillment<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE') {
        throw new RentalBookingFulfillmentConflictError('Rental fulfillment could not be serialized after bounded retries.');
      }
      if (disposition === 'CONFLICT') {
        throw new RentalBookingFulfillmentConflictError('Rental fulfillment no longer satisfies the durable booking or inventory contract.');
      }
      throw error;
    }
  }
  throw new RentalBookingFulfillmentConflictError('Rental fulfillment could not be serialized.');
}

function sameDate(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

async function recordRentalBookingFulfillmentEvent(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  kind: RentalBookingFulfillmentEventKind;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' }),
  ]);

  const idempotencyKey = rentalBookingFulfillmentIdempotencyKey(input.bookingId, input.kind);

  return runRentalBookingFulfillment(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0)
      )
    `;

    const existing = await transaction.rentalBookingFulfillmentEvent.findFirst({
      where: { organizationId: input.organizationId, bookingId: input.bookingId, kind: input.kind },
    });
    if (existing) {
      if (existing.idempotencyKey !== idempotencyKey) {
        throw new RentalBookingFulfillmentConflictError('Existing rental fulfillment evidence does not match the server-derived idempotency authority.');
      }

      const [booking, latestReschedule, latestSubstitution, history] = await Promise.all([
        transaction.rentalBooking.findFirst({
          where: { id: input.bookingId, organizationId: input.organizationId, status: 'CONFIRMED', cancelledAt: null },
          select: {
            id: true,
            unitId: true,
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
        transaction.rentalBookingFulfillmentEvent.findMany({
          where: { organizationId: input.organizationId, bookingId: input.bookingId },
          orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        }),
      ]);
      if (!booking) {
        throw new RentalBookingFulfillmentConflictError(
          'Existing rental fulfillment evidence no longer resolves to the retained confirmed booking.',
        );
      }

      const effectiveUnitId = latestSubstitution?.targetUnitId ?? booking.unitId;
      const effectiveStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
      const effectiveEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
      if (
        existing.unitId !== effectiveUnitId
        || !sameDate(existing.startsOn, effectiveStartsOn)
        || !sameDate(existing.endsOn, effectiveEndsOn)
      ) {
        throw new RentalBookingFulfillmentConflictError(
          'Existing rental fulfillment evidence no longer matches the retained physical assignment.',
        );
      }
      if (input.kind === 'PICKED_UP') {
        const pickupWindow = deriveRentalBookingPickupWindow({
          observedAt: existing.occurredAt,
          startsOn: effectiveStartsOn,
          endsOn: effectiveEndsOn,
          timeZone: booking.location.timeZone,
        });
        if (pickupWindow.state !== 'OPEN') {
          throw new RentalBookingFulfillmentConflictError(
            'Existing rental pickup evidence falls outside the retained committed rental window.',
          );
        }
      }
      if (!history.some((event) => event.id === existing.id && event.kind === input.kind)) {
        throw new RentalBookingFulfillmentConflictError(
          'Existing rental fulfillment evidence is not present in the retained custody history.',
        );
      }

      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${rentalUnitLockKey(input.organizationId, effectiveUnitId)}, 0)
        )
      `;

      return Object.freeze({ event: existing, fulfillment: deriveRentalBookingFulfillmentState(history), idempotent: true });
    }

    const [booking, latestReschedule, latestSubstitution] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: { id: input.bookingId, organizationId: input.organizationId, status: 'CONFIRMED', cancelledAt: null },
        include: { allocation: true, location: { select: { timeZone: true } } },
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
    if (!booking) throw new RentalBookingFulfillmentUnavailableError();
    if (!booking.allocation) throw new RentalAvailabilityIntegrityError('Rental fulfillment requires the booking retained physical-unit allocation.');

    const effectiveUnitId = latestSubstitution?.targetUnitId ?? booking.unitId;
    const effectiveStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const effectiveEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
    if (
      booking.allocation.organizationId !== input.organizationId
      || booking.allocation.bookingId !== booking.id
      || booking.allocation.unitId !== effectiveUnitId
      || booking.allocation.startsOn.getTime() !== effectiveStartsOn.getTime()
      || booking.allocation.endsOn.getTime() !== effectiveEndsOn.getTime()
    ) {
      throw new RentalAvailabilityIntegrityError('Rental fulfillment requires the exact current effective physical-unit allocation.');
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, effectiveUnitId)}, 0)
      )
    `;

    const [unit, history, databaseClock] = await Promise.all([
      transaction.rentalUnit.findFirst({
        where: { id: effectiveUnitId, organizationId: input.organizationId, unitTypeId: booking.unitTypeId, locationId: booking.locationId },
        select: { id: true, code: true, name: true, status: true },
      }),
      transaction.rentalBookingFulfillmentEvent.findMany({
        where: { organizationId: input.organizationId, bookingId: booking.id },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`,
    ]);
    if (!unit || unit.status !== 'ACTIVE') throw new RentalBookingFulfillmentConflictError('The effective rental unit is no longer active at the retained booking assignment.');
    if (!databaseClock[0]?.now) throw new RentalAvailabilityIntegrityError('Database clock is unavailable for rental fulfillment.');

    const current = deriveRentalBookingFulfillmentState(history);
    if (input.kind === 'PICKED_UP' && current.state !== 'AWAITING_PICKUP') {
      throw new RentalBookingFulfillmentConflictError('Only an awaiting-pickup rental booking can be picked up.');
    }
    if (input.kind === 'PICKED_UP') {
      const pickupWindow = deriveRentalBookingPickupWindow({
        observedAt: databaseClock[0].now,
        startsOn: effectiveStartsOn,
        endsOn: effectiveEndsOn,
        timeZone: booking.location.timeZone,
      });
      if (pickupWindow.state === 'BEFORE_WINDOW') {
        throw new RentalBookingPickupWindowConflictError(
          'Rental pickup cannot be recorded before the committed rental start date at the retained operating location.',
        );
      }
      if (pickupWindow.state === 'CLOSED') {
        throw new RentalBookingPickupWindowConflictError(
          'Rental pickup cannot be recorded after the exclusive committed rental end date.',
        );
      }
    }
    if (input.kind === 'RETURNED' && current.state !== 'PICKED_UP') {
      throw new RentalBookingFulfillmentConflictError('Only a picked-up rental booking can be returned.');
    }

    const event = await transaction.rentalBookingFulfillmentEvent.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        kind: input.kind,
        unitId: unit.id,
        unitCode: unit.code,
        unitName: unit.name,
        startsOn: effectiveStartsOn,
        endsOn: effectiveEndsOn,
        idempotencyKey,
        occurredAt: databaseClock[0].now,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: input.kind === 'PICKED_UP' ? 'booking.rental.picked-up' : 'booking.rental.returned',
        resourceType: 'rental-booking',
        resourceId: booking.id,
        beforeData: {
          fulfillmentState: current.state,
          unitId: unit.id,
          startsOn: effectiveStartsOn.toISOString(),
          endsOn: effectiveEndsOn.toISOString(),
        },
        afterData: {
          fulfillmentEventId: event.id,
          fulfillmentState: input.kind === 'PICKED_UP' ? 'PICKED_UP' : 'RETURNED',
          unitId: unit.id,
          occurredAt: event.occurredAt.toISOString(),
        },
      },
    });

    return Object.freeze({
      event,
      fulfillment: deriveRentalBookingFulfillmentState([...history, event]),
      idempotent: false,
    });
  }, { isolationLevel: 'Serializable' }));
}

export function recordRentalBookingPickup(input: Readonly<{ organizationId: string; actorUserId: string; bookingId: string }>) {
  return recordRentalBookingFulfillmentEvent({ ...input, kind: 'PICKED_UP' });
}

export function recordRentalBookingReturn(input: Readonly<{ organizationId: string; actorUserId: string; bookingId: string }>) {
  return recordRentalBookingFulfillmentEvent({ ...input, kind: 'RETURNED' });
}
