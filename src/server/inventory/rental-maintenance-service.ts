import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  assertRentalMaintenanceTransition,
  normalizeRentalMaintenanceCreateInput,
  normalizeRentalMaintenanceTransitionInput,
  rentalMaintenanceOperationalReason,
  type RentalMaintenanceCreateInput,
  type RentalMaintenanceTransitionInput,
} from './rental-maintenance-domain.ts';
import { rentalUnitLockKey } from './rental-lock-domain.ts';
import { classifyRentalMaintenanceStartReplay } from './rental-maintenance-start-replay.ts';
import { normalizeRentalUnitOperationalStatusInput } from './rental-unit-operational-domain.ts';
import { setLockedRentalUnitOperationalStatusInTransaction } from './rental-unit-operational-service.ts';
import {
  RentalInventoryConflictError,
  RentalInventoryUnavailableError,
} from './rental-service.ts';

async function requireRentalMaintenancePermission(
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

function normalizePage(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : 1;
}

function normalizePageSize(value: number | undefined) {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) return 20;
  return Math.min(value as number, 50);
}

function maintenanceIdempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `rental-maintenance:idempotency:${organizationId}:${idempotencyKey}`;
}

export async function readRentalUnitMaintenanceWorkOrders(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  unitId: string;
  page?: number;
  pageSize?: number;
}>) {
  assertUuidIdentifier(input.unitId, 'unitId');
  await requireRentalMaintenancePermission(input, 'inventory:read');
  const requestedPage = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);

  return db.$transaction(async (transaction) => {
    const unit = await transaction.rentalUnit.findFirst({
      where: {
        id: input.unitId,
        organizationId: input.organizationId,
        status: 'ACTIVE',
      },
      select: { id: true, name: true, code: true },
    });
    if (!unit) {
      throw new RentalInventoryUnavailableError('Rental unit is not active in this organization.');
    }

    const where = {
      organizationId: input.organizationId,
      unitId: input.unitId,
    };
    const total = await transaction.rentalMaintenanceWorkOrder.count({ where });
    const activeTotal = await transaction.rentalMaintenanceWorkOrder.count({
      where: {
        ...where,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      },
    });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const items = await transaction.rentalMaintenanceWorkOrder.findMany({
      where,
      orderBy: [{ status: 'asc' }, { openedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return Object.freeze({
      unit,
      items,
      page,
      pageSize,
      total,
      activeTotal,
      totalPages,
    });
  }, { isolationLevel: 'RepeatableRead' });
}

export async function createRentalMaintenanceWorkOrder(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  unitId: string;
  workOrder: RentalMaintenanceCreateInput;
}>) {
  assertUuidIdentifier(input.unitId, 'unitId');
  await requireRentalMaintenancePermission(input, 'inventory:manage');
  const workOrder = normalizeRentalMaintenanceCreateInput(input.workOrder);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${maintenanceIdempotencyLockKey(input.organizationId, workOrder.idempotencyKey)}, 0)
      )
    `;

    const existing = await transaction.rentalMaintenanceWorkOrder.findFirst({
      where: {
        organizationId: input.organizationId,
        idempotencyKey: workOrder.idempotencyKey,
      },
    });
    if (existing) {
      if (
        existing.unitId !== input.unitId ||
        existing.title !== workOrder.title ||
        existing.description !== workOrder.description
      ) {
        throw new RentalInventoryConflictError(
          'Maintenance idempotency key is already bound to different work-order evidence.',
        );
      }
      return Object.freeze({ workOrder: existing, idempotent: true as const });
    }

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
      throw new RentalInventoryUnavailableError('Rental unit is not active in this organization.');
    }

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
          reason: rentalMaintenanceOperationalReason(workOrder.title),
        }),
      });
    }

    const created = await transaction.rentalMaintenanceWorkOrder.create({
      data: {
        organizationId: input.organizationId,
        unitId: unit.id,
        idempotencyKey: workOrder.idempotencyKey,
        title: workOrder.title,
        description: workOrder.description,
        openedByUserId: input.actorUserId,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rental-maintenance.work-order-opened',
        resourceType: 'rental-maintenance-work-order',
        resourceId: created.id,
        afterData: {
          unitId: unit.id,
          unitCode: unit.code,
          status: created.status,
          title: created.title,
          openedAt: created.openedAt.toISOString(),
        },
      },
    });

    return Object.freeze({ workOrder: created, idempotent: false as const });
  }, { isolationLevel: 'Serializable' });
}

export async function transitionRentalMaintenanceWorkOrder(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  unitId: string;
  workOrderId: string;
  transition: RentalMaintenanceTransitionInput;
}>) {
  assertUuidIdentifier(input.unitId, 'unitId');
  assertUuidIdentifier(input.workOrderId, 'workOrderId');
  await requireRentalMaintenancePermission(input, 'inventory:manage');
  const transition = normalizeRentalMaintenanceTransitionInput(input.transition);

  return db.$transaction(async (transaction) => {
    const located = await transaction.rentalMaintenanceWorkOrder.findFirst({
      where: {
        id: input.workOrderId,
        organizationId: input.organizationId,
        unitId: input.unitId,
      },
      select: { id: true, unitId: true },
    });
    if (!located) {
      throw new RentalInventoryUnavailableError('Maintenance work order is not available in this organization.');
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, located.unitId)}, 0)
      )
    `;

    const current = await transaction.rentalMaintenanceWorkOrder.findFirst({
      where: {
        id: located.id,
        organizationId: input.organizationId,
        unitId: located.unitId,
      },
    });
    if (!current) {
      throw new RentalInventoryConflictError('Maintenance work order changed before it could be updated.');
    }

    if (transition.status === 'IN_PROGRESS') {
      const startReplayDisposition = classifyRentalMaintenanceStartReplay(current);
      if (startReplayDisposition === 'REPLAY') {
        return Object.freeze({ workOrder: current, idempotent: true as const });
      }
      if (startReplayDisposition === 'INVALID_TRANSITION') {
        throw new RentalInventoryConflictError(
          'Maintenance start replay requires complete retained start evidence.',
        );
      }
    }

    if (current.status === transition.status) {
      const evidenceMatches =
        (transition.status !== 'COMPLETED' || current.completionNotes === transition.completionNotes) &&
        (transition.status !== 'CANCELLED' || current.cancellationReason === transition.cancellationReason);
      if (!evidenceMatches) {
        throw new RentalInventoryConflictError(
          'Maintenance status is already recorded with different retained evidence.',
        );
      }
      return Object.freeze({ workOrder: current, idempotent: true as const });
    }

    assertRentalMaintenanceTransition(current.status, transition.status);

    const data = transition.status === 'IN_PROGRESS'
      ? { status: transition.status, startedByUserId: input.actorUserId }
      : transition.status === 'COMPLETED'
        ? {
            status: transition.status,
            completedByUserId: input.actorUserId,
            completionNotes: transition.completionNotes,
          }
        : {
            status: transition.status,
            cancelledByUserId: input.actorUserId,
            cancellationReason: transition.cancellationReason,
          };

    const updated = await transaction.rentalMaintenanceWorkOrder.updateMany({
      where: {
        id: current.id,
        organizationId: input.organizationId,
        unitId: located.unitId,
        status: current.status,
      },
      data,
    });
    if (updated.count !== 1) {
      throw new RentalInventoryConflictError('Maintenance work order changed before it could be updated.');
    }

    const workOrder = await transaction.rentalMaintenanceWorkOrder.findFirst({
      where: {
        id: current.id,
        organizationId: input.organizationId,
        unitId: located.unitId,
      },
    });
    if (!workOrder) {
      throw new RentalInventoryConflictError('Maintenance work order could not be reloaded after update.');
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rental-maintenance.work-order-status-changed',
        resourceType: 'rental-maintenance-work-order',
        resourceId: workOrder.id,
        beforeData: { unitId: located.unitId, status: current.status },
        afterData: { unitId: located.unitId, status: workOrder.status },
      },
    });

    return Object.freeze({ workOrder, idempotent: false as const });
  }, { isolationLevel: 'Serializable' });
}
