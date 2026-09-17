import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { RentalInventoryConflictError, RentalInventoryUnavailableError } from '../inventory/rental-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';
import { rentalBookingLockKey } from './rental-booking-reschedule-domain.ts';
import {
  deriveRentalLateReturnTiming,
  normalizeRentalLateReturnAssessmentInput,
  type RentalLateReturnAssessmentInput,
} from './rental-late-return-domain.ts';

async function runLateReturnWrite<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE' || disposition === 'CONFLICT') {
        throw new RentalInventoryConflictError('Late-return assessment changed concurrently. Refresh the retained evidence and try again.');
      }
      throw error;
    }
  }
  throw new RentalInventoryConflictError('Late-return assessment could not be serialized.');
}

function assessmentIdempotencyKey(bookingId: string) {
  return `rental-late-return-assessment:${bookingId}`;
}

async function requireLateReturnReadPermissions(input: Readonly<{ organizationId: string; actorUserId: string }>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:read' }),
  ]);
}

async function requireLateReturnWritePermissions(input: Readonly<{ organizationId: string; actorUserId: string }>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);
}

export async function readRentalLateReturnAssessment(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireLateReturnReadPermissions(input);

  const booking = await db.rentalBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    select: {
      id: true,
      status: true,
      currency: true,
      location: { select: { timeZone: true } },
      fulfillmentEvents: {
        where: { organizationId: input.organizationId },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: { id: true, kind: true, unitId: true, endsOn: true, occurredAt: true },
      },
      lateReturnAssessment: true,
    },
  });
  if (!booking) throw new RentalInventoryUnavailableError('Rental booking is not available for late-return assessment in this organization.');

  const returnEvent = booking.fulfillmentEvents.find((event) => event.kind === 'RETURNED') ?? null;
  const pickupEvent = booking.fulfillmentEvents.find((event) => event.kind === 'PICKED_UP') ?? null;
  let lateDays = 0;
  if (returnEvent) {
    if (
      !pickupEvent
      || returnEvent.unitId !== pickupEvent.unitId
      || returnEvent.endsOn.getTime() !== pickupEvent.endsOn.getTime()
      || returnEvent.occurredAt.getTime() < pickupEvent.occurredAt.getTime()
    ) {
      throw new RentalInventoryConflictError('Retained rental custody evidence is inconsistent for late-return assessment.');
    }
    lateDays = deriveRentalLateReturnTiming({
      returnedAt: returnEvent.occurredAt,
      committedEndsOn: returnEvent.endsOn,
      timeZone: booking.location.timeZone,
      graceDays: 0,
    }).lateDays;
  }

  return Object.freeze({
    booking: Object.freeze({ id: booking.id, status: booking.status, currency: booking.currency }),
    returnEvent,
    lateDays,
    assessment: booking.lateReturnAssessment,
  });
}

export async function assessRentalLateReturn(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  assessment: RentalLateReturnAssessmentInput;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireLateReturnWritePermissions(input);

  return runLateReturnWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0))`;

    const booking = await transaction.rentalBooking.findFirst({
      where: {
        id: input.bookingId,
        organizationId: input.organizationId,
        status: 'CONFIRMED',
      },
      select: {
        id: true,
        currency: true,
        location: { select: { timeZone: true } },
        fulfillmentEvents: {
          where: { organizationId: input.organizationId },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { id: true, kind: true, unitId: true, startsOn: true, endsOn: true, occurredAt: true },
        },
      },
    });
    if (!booking) throw new RentalInventoryUnavailableError('Rental booking is not available for late-return assessment in this organization.');

    const pickupEvent = booking.fulfillmentEvents.find((event) => event.kind === 'PICKED_UP');
    const returnEvent = booking.fulfillmentEvents.find((event) => event.kind === 'RETURNED');
    if (
      !pickupEvent
      || !returnEvent
      || pickupEvent.unitId !== returnEvent.unitId
      || pickupEvent.startsOn.getTime() !== returnEvent.startsOn.getTime()
      || pickupEvent.endsOn.getTime() !== returnEvent.endsOn.getTime()
      || returnEvent.occurredAt.getTime() < pickupEvent.occurredAt.getTime()
    ) {
      throw new RentalInventoryConflictError('Late-return assessment requires complete consistent pickup and return custody evidence.');
    }

    const normalized = normalizeRentalLateReturnAssessmentInput(input.assessment, {
      currency: booking.currency,
      returnedAt: returnEvent.occurredAt,
      committedEndsOn: returnEvent.endsOn,
      timeZone: booking.location.timeZone,
    });
    const idempotencyKey = assessmentIdempotencyKey(booking.id);

    const existing = await transaction.rentalLateReturnAssessment.findUnique({
      where: { organizationId_bookingId: { organizationId: input.organizationId, bookingId: booking.id } },
    });
    if (existing) {
      if (
        existing.returnEventId !== returnEvent.id
        || existing.unitId !== returnEvent.unitId
        || existing.outcome !== normalized.outcome
        || existing.committedEndsOn.getTime() !== returnEvent.endsOn.getTime()
        || existing.returnedAt.getTime() !== returnEvent.occurredAt.getTime()
        || existing.lateDays !== normalized.lateDays
        || existing.graceDays !== normalized.graceDays
        || existing.chargeableDays !== normalized.chargeableDays
        || existing.currency !== normalized.currency
        || existing.feeMinor !== normalized.feeMinor
        || existing.reason !== normalized.reason
        || existing.idempotencyKey !== idempotencyKey
      ) {
        throw new RentalInventoryConflictError('This rental booking already has a different retained late-return assessment.');
      }
      return Object.freeze({ assessment: existing, idempotent: true as const });
    }

    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    if (!databaseClock?.now) throw new RentalInventoryConflictError('Database time authority is unavailable for late-return assessment.');

    const created = await transaction.rentalLateReturnAssessment.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        unitId: returnEvent.unitId,
        returnEventId: returnEvent.id,
        idempotencyKey,
        outcome: normalized.outcome,
        committedEndsOn: returnEvent.endsOn,
        returnedAt: returnEvent.occurredAt,
        lateDays: normalized.lateDays,
        graceDays: normalized.graceDays,
        chargeableDays: normalized.chargeableDays,
        currency: normalized.currency,
        feeMinor: normalized.feeMinor,
        reason: normalized.reason,
        assessedAt: databaseClock.now,
        assessedByUserId: input.actorUserId,
        createdAt: databaseClock.now,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.late-return-assessed',
        resourceType: 'rental-late-return-assessment',
        resourceId: created.id,
        afterData: {
          bookingId: booking.id,
          unitId: created.unitId,
          returnEventId: created.returnEventId,
          outcome: created.outcome,
          lateDays: created.lateDays,
          graceDays: created.graceDays,
          chargeableDays: created.chargeableDays,
          currency: created.currency,
          feeMinor: created.feeMinor?.toString() ?? null,
          assessedAt: created.assessedAt.toISOString(),
        },
      },
    });

    return Object.freeze({ assessment: created, idempotent: false as const });
  }, { isolationLevel: 'Serializable' }));
}
