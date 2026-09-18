import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { RentalInventoryConflictError, RentalInventoryUnavailableError } from '../inventory/rental-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  RentalCustodySnapshotIntegrityError,
  validateRentalCustodyReturnSnapshot,
} from './rental-custody-return-snapshot-domain.ts';
import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';
import { rentalBookingLockKey } from './rental-booking-reschedule-domain.ts';
import {
  deriveRentalLateReturnTiming,
  normalizeRentalLateReturnAssessmentInput,
  type RentalLateReturnAssessmentInput,
  type RentalLateReturnPolicyAuthority,
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

function requireConsistentLateReturnCustody(
  pickupEvent: Readonly<{ unitId: string; startsOn: Date; endsOn: Date; occurredAt: Date }> | null | undefined,
  returnEvent: Readonly<{ unitId: string; startsOn: Date; endsOn: Date; occurredAt: Date }> | null | undefined,
) {
  if (!pickupEvent || !returnEvent) {
    throw new RentalInventoryConflictError('Late-return assessment requires complete pickup and return custody evidence.');
  }
  try {
    return validateRentalCustodyReturnSnapshot({ pickup: pickupEvent, returned: returnEvent });
  } catch (error) {
    if (error instanceof RentalCustodySnapshotIntegrityError) {
      throw new RentalInventoryConflictError('Retained rental custody evidence is inconsistent for late-return assessment.');
    }
    throw error;
  }
}

function activePolicyAuthority(
  revision: Readonly<{
    id: string;
    enabled: boolean;
    graceDays: number;
    dailyFeeMinor: bigint | null;
    currency: string;
  }> | null,
): RentalLateReturnPolicyAuthority | null {
  if (!revision?.enabled) return null;
  if (revision.dailyFeeMinor === null || revision.dailyFeeMinor <= 0n) {
    throw new RentalInventoryConflictError('Enabled late-return policy is missing positive daily-fee authority.');
  }
  return Object.freeze({
    id: revision.id,
    currency: revision.currency,
    graceDays: revision.graceDays,
    dailyFeeMinor: revision.dailyFeeMinor,
  });
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
      unitTypeId: true,
      currency: true,
      location: { select: { timeZone: true } },
      fulfillmentEvents: {
        where: { organizationId: input.organizationId },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: { id: true, kind: true, unitId: true, startsOn: true, endsOn: true, occurredAt: true },
      },
      lateReturnAssessment: true,
    },
  });
  if (!booking) throw new RentalInventoryUnavailableError('Rental booking is not available for late-return assessment in this organization.');

  const returnEvent = booking.fulfillmentEvents.find((event) => event.kind === 'RETURNED') ?? null;
  const pickupEvent = booking.fulfillmentEvents.find((event) => event.kind === 'PICKED_UP') ?? null;
  let lateDays = 0;
  let applicablePolicyRevision = null;
  let policy: RentalLateReturnPolicyAuthority | null = null;
  let policyChargeableDays: number | null = null;
  let policyFeeMinor: bigint | null = null;

  if (returnEvent) {
    requireConsistentLateReturnCustody(pickupEvent, returnEvent);
    lateDays = deriveRentalLateReturnTiming({
      returnedAt: returnEvent.occurredAt,
      committedEndsOn: returnEvent.endsOn,
      timeZone: booking.location.timeZone,
      graceDays: 0,
    }).lateDays;

    applicablePolicyRevision = await db.rentalLateReturnPolicyRevision.findFirst({
      where: {
        organizationId: input.organizationId,
        unitTypeId: booking.unitTypeId,
        effectiveAt: { lte: returnEvent.occurredAt },
      },
      orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }, { id: 'desc' }],
    });
    policy = activePolicyAuthority(applicablePolicyRevision);
    if (policy) {
      const policyTiming = deriveRentalLateReturnTiming({
        returnedAt: returnEvent.occurredAt,
        committedEndsOn: returnEvent.endsOn,
        timeZone: booking.location.timeZone,
        graceDays: policy.graceDays,
      });
      policyChargeableDays = policyTiming.chargeableDays;
      policyFeeMinor = policy.dailyFeeMinor * BigInt(policyTiming.chargeableDays);
    }
  }

  const assessmentPolicyRevision = booking.lateReturnAssessment?.policyRevisionId
    ? await db.rentalLateReturnPolicyRevision.findFirst({
        where: {
          id: booking.lateReturnAssessment.policyRevisionId,
          organizationId: input.organizationId,
          unitTypeId: booking.unitTypeId,
        },
      })
    : null;

  return Object.freeze({
    booking: Object.freeze({ id: booking.id, status: booking.status, currency: booking.currency }),
    returnEvent,
    lateDays,
    assessment: booking.lateReturnAssessment,
    assessmentPolicyRevision,
    applicablePolicyRevision,
    policy,
    policyChargeableDays,
    policyFeeMinor,
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
        unitTypeId: true,
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
    requireConsistentLateReturnCustody(pickupEvent, returnEvent);
    if (!returnEvent) throw new RentalInventoryConflictError('Late-return assessment requires retained return evidence.');

    const policyRevision = await transaction.rentalLateReturnPolicyRevision.findFirst({
      where: {
        organizationId: input.organizationId,
        unitTypeId: booking.unitTypeId,
        effectiveAt: { lte: returnEvent.occurredAt },
      },
      orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }, { id: 'desc' }],
    });
    const policy = activePolicyAuthority(policyRevision);

    const normalized = normalizeRentalLateReturnAssessmentInput(input.assessment, {
      currency: booking.currency,
      returnedAt: returnEvent.occurredAt,
      committedEndsOn: returnEvent.endsOn,
      timeZone: booking.location.timeZone,
      policy,
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
        || existing.policyRevisionId !== normalized.policyRevisionId
        || existing.policyDailyFeeMinor !== normalized.policyDailyFeeMinor
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
        policyRevisionId: normalized.policyRevisionId,
        policyDailyFeeMinor: normalized.policyDailyFeeMinor,
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
          policyRevisionId: created.policyRevisionId,
          policyDailyFeeMinor: created.policyDailyFeeMinor?.toString() ?? null,
          assessedAt: created.assessedAt.toISOString(),
        },
      },
    });

    return Object.freeze({ assessment: created, idempotent: false as const });
  }, { isolationLevel: 'Serializable' }));
}
