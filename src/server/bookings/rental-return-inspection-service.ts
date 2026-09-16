import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { normalizeRentalUnitOperationalStatusInput } from '../inventory/rental-unit-operational-domain.ts';
import { setLockedRentalUnitOperationalStatusInTransaction } from '../inventory/rental-unit-operational-service.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import {
  RentalInventoryConflictError,
  RentalInventoryUnavailableError,
} from '../inventory/rental-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  normalizeRentalReturnInspectionInput,
  rentalReturnInspectionOperationalReason,
  type RentalReturnInspectionInput,
} from './rental-return-inspection-domain.ts';

function inspectionIdempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `rental-return-inspection:idempotency:${organizationId}:${idempotencyKey}`;
}

async function requireRentalReturnInspectionReadPermission(
  input: Readonly<{ organizationId: string; actorUserId: string }>,
) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:read',
  });
}

async function requireRentalReturnInspectionWritePermissions(
  input: Readonly<{ organizationId: string; actorUserId: string }>,
) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
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
}

export async function readRentalReturnInspection(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireRentalReturnInspectionReadPermission(input);

  return db.rentalReturnInspection.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    },
  });
}

export async function recordRentalReturnInspection(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  inspection: RentalReturnInspectionInput;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireRentalReturnInspectionWritePermissions(input);
  const inspection = normalizeRentalReturnInspectionInput(input.inspection);
  const idempotencyKey = `rental-return-inspection:${input.bookingId}`;

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${inspectionIdempotencyLockKey(input.organizationId, idempotencyKey)}, 0)
      )
    `;

    const idempotent = await transaction.rentalReturnInspection.findFirst({
      where: {
        organizationId: input.organizationId,
        idempotencyKey,
      },
    });
    if (idempotent) {
      if (
        idempotent.bookingId !== input.bookingId
        || idempotent.outcome !== inspection.outcome
        || idempotent.notes !== inspection.notes
      ) {
        throw new RentalInventoryConflictError(
          'Return inspection idempotency key is already bound to different evidence.',
        );
      }
      return Object.freeze({ inspection: idempotent, idempotent: true as const });
    }

    const returnEvent = await transaction.rentalBookingFulfillmentEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        kind: 'RETURNED',
      },
      select: {
        id: true,
        unitId: true,
      },
    });
    if (!returnEvent) {
      throw new RentalInventoryUnavailableError(
        'Return inspection requires retained return custody evidence in this organization.',
      );
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, returnEvent.unitId)}, 0)
      )
    `;

    const [booking, currentReturnEvent, existingInspection, unit] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: {
          id: input.bookingId,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
        },
        select: { id: true },
      }),
      transaction.rentalBookingFulfillmentEvent.findFirst({
        where: {
          id: returnEvent.id,
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          kind: 'RETURNED',
          unitId: returnEvent.unitId,
        },
        select: { id: true, unitId: true },
      }),
      transaction.rentalReturnInspection.findFirst({
        where: {
          organizationId: input.organizationId,
          bookingId: input.bookingId,
        },
      }),
      transaction.rentalUnit.findFirst({
        where: {
          id: returnEvent.unitId,
          organizationId: input.organizationId,
          status: 'ACTIVE',
        },
        select: { id: true, code: true },
      }),
    ]);

    if (!booking || !currentReturnEvent || !unit) {
      throw new RentalInventoryUnavailableError(
        'Return inspection authority changed before the inspection could be recorded.',
      );
    }
    if (existingInspection) {
      throw new RentalInventoryConflictError(
        'This rental booking already has retained return inspection evidence.',
      );
    }

    if (inspection.outcome !== 'CLEAR') {
      const operationalState = await transaction.rentalUnitOperationalState.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: unit.id,
        },
        select: { status: true },
      });
      if (operationalState?.status !== 'OUT_OF_SERVICE') {
        await setLockedRentalUnitOperationalStatusInTransaction({
          transaction,
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          unit,
          operational: normalizeRentalUnitOperationalStatusInput({
            status: 'OUT_OF_SERVICE',
            reason: rentalReturnInspectionOperationalReason(inspection.outcome),
          }),
        });
      }
    }

    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!(databaseClock?.now instanceof Date) || Number.isNaN(databaseClock.now.getTime())) {
      throw new RentalInventoryConflictError(
        'Database time authority is unavailable for rental return inspection.',
      );
    }

    const created = await transaction.rentalReturnInspection.create({
      data: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        returnEventId: currentReturnEvent.id,
        unitId: currentReturnEvent.unitId,
        idempotencyKey,
        outcome: inspection.outcome,
        notes: inspection.notes,
        inspectedAt: databaseClock.now,
        inspectedByUserId: input.actorUserId,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.return-inspection-recorded',
        resourceType: 'rental-return-inspection',
        resourceId: created.id,
        afterData: {
          bookingId: input.bookingId,
          returnEventId: currentReturnEvent.id,
          unitId: unit.id,
          unitCode: unit.code,
          outcome: created.outcome,
          inspectedAt: created.inspectedAt.toISOString(),
        },
      },
    });

    return Object.freeze({ inspection: created, idempotent: false as const });
  }, { isolationLevel: 'Serializable' });
}
