import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  normalizeRentalUnitOperationalStatusInput,
  type RentalUnitOperationalStatusInput,
} from './rental-unit-operational-domain.ts';
import { rentalUnitLockKey } from './rental-lock-domain.ts';
import {
  RentalInventoryConflictError,
  RentalInventoryUnavailableError,
} from './rental-service.ts';

async function requireRentalUnitOperationalPermission(
  input: Readonly<{ organizationId: string; actorUserId: string }>,
  permission: 'inventory:read' | 'inventory:manage',
) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission,
  });
}

export async function readRentalUnitOperationalState(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  unitId: string;
}>) {
  assertUuidIdentifier(input.unitId, 'unitId');
  await requireRentalUnitOperationalPermission(input, 'inventory:read');

  const [unit, state] = await db.$transaction([
    db.rentalUnit.findFirst({
      where: {
        id: input.unitId,
        organizationId: input.organizationId,
        status: 'ACTIVE',
      },
      select: { id: true },
    }),
    db.rentalUnitOperationalState.findFirst({
      where: {
        organizationId: input.organizationId,
        unitId: input.unitId,
      },
    }),
  ]);
  if (!unit) {
    throw new RentalInventoryUnavailableError(
      'Rental unit is not active in this organization.',
    );
  }

  if (!state) {
    return Object.freeze({
      organizationId: input.organizationId,
      unitId: unit.id,
      status: 'AVAILABLE' as const,
      reason: null,
      changedAt: null,
      changedByUserId: null,
      persisted: false as const,
    });
  }

  return Object.freeze({ ...state, persisted: true as const });
}

export async function setLockedRentalUnitOperationalStatusInTransaction(input: Readonly<{
  transaction: Prisma.TransactionClient;
  organizationId: string;
  actorUserId: string;
  unit: Readonly<{ id: string; code: string }>;
  operational: ReturnType<typeof normalizeRentalUnitOperationalStatusInput>;
}>) {
  const current = await input.transaction.rentalUnitOperationalState.findFirst({
    where: {
      organizationId: input.organizationId,
      unitId: input.unit.id,
    },
  });
  const currentStatus = current?.status ?? 'AVAILABLE';
  const currentReason = current?.reason ?? null;

  if (input.operational.status === 'AVAILABLE') {
    const [
      pendingReturnInspection,
      unresolvedNonClearInspection,
      activeMaintenance,
      activeDamageCases,
    ] = await Promise.all([
      input.transaction.rentalBookingFulfillmentEvent.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: input.unit.id,
          kind: 'RETURNED',
          returnInspection: { is: null },
        },
        select: { id: true },
      }),
      input.transaction.rentalReturnInspection.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: input.unit.id,
          outcome: { in: ['DAMAGE_REPORTED', 'UNSAFE'] },
          damageCase: { is: null },
        },
        select: { id: true },
      }),
      input.transaction.rentalMaintenanceWorkOrder.count({
        where: {
          organizationId: input.organizationId,
          unitId: input.unit.id,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
        },
      }),
      input.transaction.rentalDamageCase.count({
        where: {
          organizationId: input.organizationId,
          unitId: input.unit.id,
          status: { in: ['OPEN', 'ASSESSED'] },
        },
      }),
    ]);
    if (pendingReturnInspection) {
      throw new RentalInventoryConflictError(
        'Record the pending rental return inspection before returning this rental unit to service.',
      );
    }
    if (unresolvedNonClearInspection) {
      throw new RentalInventoryConflictError(
        'Resolve the non-clear rental return inspection through its damage case before returning this rental unit to service.',
      );
    }
    if (activeMaintenance > 0) {
      throw new RentalInventoryConflictError(
        'Complete or cancel active maintenance work before returning this rental unit to service.',
      );
    }
    if (activeDamageCases > 0) {
      throw new RentalInventoryConflictError(
        'Waive or close unresolved damage cases before returning this rental unit to service.',
      );
    }
  }

  if (currentStatus === input.operational.status && currentReason === input.operational.reason) {
    return Object.freeze({
      state: current ?? {
        organizationId: input.organizationId,
        unitId: input.unit.id,
        status: 'AVAILABLE' as const,
        reason: null,
        changedAt: null,
        changedByUserId: null,
      },
      idempotent: true as const,
    });
  }

  const [databaseClock] = await input.transaction.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS "now"
  `;
  if (!databaseClock?.now) {
    throw new RentalInventoryConflictError(
      'Database time authority is unavailable for rental unit operational status.',
    );
  }

  let state;
  if (current) {
    const updated = await input.transaction.rentalUnitOperationalState.updateMany({
      where: {
        id: current.id,
        organizationId: input.organizationId,
        unitId: input.unit.id,
      },
      data: {
        status: input.operational.status,
        reason: input.operational.reason,
        changedAt: databaseClock.now,
        changedByUserId: input.actorUserId,
        updatedAt: databaseClock.now,
      },
    });
    if (updated.count !== 1) {
      throw new RentalInventoryConflictError(
        'Rental unit operational status changed before it could be updated.',
      );
    }
    state = await input.transaction.rentalUnitOperationalState.findFirst({
      where: {
        id: current.id,
        organizationId: input.organizationId,
        unitId: input.unit.id,
      },
    });
    if (!state) {
      throw new RentalInventoryConflictError(
        'Rental unit operational status could not be reloaded after update.',
      );
    }
  } else {
    state = await input.transaction.rentalUnitOperationalState.create({
      data: {
        organizationId: input.organizationId,
        unitId: input.unit.id,
        status: input.operational.status,
        reason: input.operational.reason,
        changedAt: databaseClock.now,
        changedByUserId: input.actorUserId,
      },
    });
  }

  await input.transaction.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'inventory.rental-unit.operational-status-changed',
      resourceType: 'rental-unit',
      resourceId: input.unit.id,
      beforeData: {
        unitCode: input.unit.code,
        status: currentStatus,
        reason: currentReason,
      },
      afterData: {
        unitCode: input.unit.code,
        status: state.status,
        reason: state.reason,
        changedAt: state.changedAt.toISOString(),
      },
    },
  });

  return Object.freeze({ state, idempotent: false as const });
}

export async function setRentalUnitOperationalStatus(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  unitId: string;
  operational: RentalUnitOperationalStatusInput;
}>) {
  assertUuidIdentifier(input.unitId, 'unitId');
  await requireRentalUnitOperationalPermission(input, 'inventory:manage');
  const operational = normalizeRentalUnitOperationalStatusInput(input.operational);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, input.unitId)}, 0)
      )
    `;

    const unit = await transaction.rentalUnit.findFirst({
      where: {
        id: input.unitId,
        organizationId: input.organizationId,
        status: 'ACTIVE',
      },
      select: { id: true, code: true },
    });
    if (!unit) {
      throw new RentalInventoryUnavailableError(
        'Rental unit is not active in this organization.',
      );
    }

    return setLockedRentalUnitOperationalStatusInTransaction({
      transaction,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      unit,
      operational,
    });
  }, { isolationLevel: 'Serializable' });
}
