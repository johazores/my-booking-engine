import { hospitalityAvailabilityAllocationLockKey } from '../availability/availability-allocation-lock.ts';
import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { assertInventoryArchiveConfirmation } from './hospitality-domain.ts';
import { normalizeHospitalityRatePlanInput, type HospitalityRatePlanInput } from './hospitality-rate-plan-domain.ts';
import {
  HospitalityInventoryConflictError,
  HospitalityInventoryDependencyError,
  HospitalityInventoryUnavailableError,
} from './hospitality-service.ts';

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function listHospitalityRatePlans(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
  const where = { organizationId: input.organizationId, propertyId: input.propertyId };
  const total = await db.hospitalityRatePlan.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const ratePlans = await db.hospitalityRatePlan.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
    include: { _count: { select: { roomTypeAssignments: true, restrictions: true } } },
  });
  return { ratePlans, total, page, totalPages };
}

export async function readHospitalityRatePlan(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  ratePlanId: string;
}) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.ratePlanId, 'ratePlanId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
  return db.hospitalityRatePlan.findFirst({
    where: { id: input.ratePlanId, propertyId: input.propertyId, organizationId: input.organizationId },
    include: { _count: { select: { roomTypeAssignments: true, restrictions: true } } },
  });
}

export async function listHospitalityRatePlanRoomTypes(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  ratePlanId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.ratePlanId, 'ratePlanId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
  const ratePlan = await db.hospitalityRatePlan.findFirst({
    where: { id: input.ratePlanId, propertyId: input.propertyId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!ratePlan) throw new HospitalityInventoryUnavailableError('Rate plan is not available for this property.');

  const where = { organizationId: input.organizationId, propertyId: input.propertyId };
  const total = await db.hospitalityRoomType.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const roomTypes = await db.hospitalityRoomType.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
    include: {
      ratePlanAssignments: {
        where: { ratePlanId: input.ratePlanId },
        select: { ratePlanId: true, createdAt: true },
      },
    },
  });
  return { roomTypes, total, page, totalPages };
}

export async function createHospitalityRatePlan(input: {
  organizationId: string;
  actorUserId: string;
  ratePlan: HospitalityRatePlanInput;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  const ratePlan = normalizeHospitalityRatePlanInput(input.ratePlan);
  assertUuidIdentifier(ratePlan.propertyId, 'propertyId');

  try {
    return await db.$transaction(async (transaction) => {
      const property = await transaction.hospitalityProperty.findFirst({
        where: { id: ratePlan.propertyId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!property) throw new HospitalityInventoryUnavailableError('Property is not available in this organization.');
      const created = await transaction.hospitalityRatePlan.create({
        data: { organizationId: input.organizationId, ...ratePlan },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.rate-plan.created',
          resourceType: 'hospitality-rate-plan',
          resourceId: created.id,
          afterData: { propertyId: created.propertyId, code: created.code, status: created.status },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new HospitalityInventoryConflictError('A rate plan with that code already exists for this property.');
    throw error;
  }
}

export async function assignHospitalityRatePlanToRoomType(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
}) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(input.ratePlanId, 'ratePlanId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });

  return db.$transaction(async (transaction) => {
    const [roomType, ratePlan] = await Promise.all([
      transaction.hospitalityRoomType.findFirst({
        where: {
          id: input.roomTypeId,
          propertyId: input.propertyId,
          organizationId: input.organizationId,
          status: 'ACTIVE',
          property: { is: { status: 'ACTIVE' } },
        },
        select: { id: true, propertyId: true },
      }),
      transaction.hospitalityRatePlan.findFirst({
        where: {
          id: input.ratePlanId,
          propertyId: input.propertyId,
          organizationId: input.organizationId,
          status: 'ACTIVE',
          property: { is: { status: 'ACTIVE' } },
        },
        select: { id: true, propertyId: true },
      }),
    ]);
    if (!roomType || !ratePlan) throw new HospitalityInventoryUnavailableError('Room type or rate plan is not available for this property.');

    const key = {
      organizationId: input.organizationId,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
    };
    const existing = await transaction.hospitalityRoomTypeRatePlan.findUnique({
      where: { organizationId_roomTypeId_ratePlanId: key },
    });
    if (existing) return existing;

    const assignment = await transaction.hospitalityRoomTypeRatePlan.create({
      data: { ...key, propertyId: input.propertyId },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rate-plan.assigned-room-type',
        resourceType: 'hospitality-rate-plan',
        resourceId: ratePlan.id,
        afterData: { propertyId: input.propertyId, roomTypeId: roomType.id },
      },
    });
    return assignment;
  }, { isolationLevel: 'Serializable' });
}

export async function removeHospitalityRatePlanFromRoomType(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
}) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(input.ratePlanId, 'ratePlanId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityAvailabilityAllocationLockKey({ organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId })}, 0))`;
    const key = { organizationId: input.organizationId, roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId };
    const [roomType, ratePlan, existing] = await Promise.all([
      transaction.hospitalityRoomType.findFirst({
        where: {
          id: input.roomTypeId,
          propertyId: input.propertyId,
          organizationId: input.organizationId,
          status: 'ACTIVE',
          property: { is: { status: 'ACTIVE' } },
        },
        select: { id: true },
      }),
      transaction.hospitalityRatePlan.findFirst({
        where: {
          id: input.ratePlanId,
          propertyId: input.propertyId,
          organizationId: input.organizationId,
          status: 'ACTIVE',
          property: { is: { status: 'ACTIVE' } },
        },
        select: { id: true },
      }),
      transaction.hospitalityRoomTypeRatePlan.findUnique({
        where: { organizationId_roomTypeId_ratePlanId: key },
        select: { propertyId: true },
      }),
    ]);
    if (!roomType || !ratePlan || !existing || existing.propertyId !== input.propertyId) {
      throw new HospitalityInventoryUnavailableError('Rate plan assignment is not available for active inventory in this property.');
    }
    const [activeRestrictions, activeHolds] = await Promise.all([
      transaction.hospitalityRestriction.count({
        where: {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          ratePlanId: input.ratePlanId,
          roomTypeId: input.roomTypeId,
          status: 'ACTIVE',
        },
      }),
      transaction.hospitalityAvailabilityHold.count({
        where: {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          roomTypeId: input.roomTypeId,
          ratePlanId: input.ratePlanId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
      }),
    ]);
    if (activeRestrictions > 0) {
      throw new HospitalityInventoryDependencyError('Archive active room-type restrictions before removing this rate plan assignment.');
    }
    if (activeHolds > 0) {
      throw new HospitalityInventoryDependencyError('Release or expire active availability holds before removing this rate plan assignment.');
    }
    await transaction.hospitalityRoomTypeRatePlan.delete({ where: { organizationId_roomTypeId_ratePlanId: key } });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rate-plan.removed-room-type',
        resourceType: 'hospitality-rate-plan',
        resourceId: input.ratePlanId,
        beforeData: { propertyId: input.propertyId, roomTypeId: input.roomTypeId },
      },
    });
    return true;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveHospitalityRatePlan(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  ratePlanId: string;
  confirmation: string;
}) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.ratePlanId, 'ratePlanId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  assertInventoryArchiveConfirmation(input.confirmation);

  return db.$transaction(async (transaction) => {
    const current = await transaction.hospitalityRatePlan.findFirst({
      where: {
        id: input.ratePlanId,
        propertyId: input.propertyId,
        organizationId: input.organizationId,
        status: 'ACTIVE',
        property: { is: { status: 'ACTIVE' } },
      },
      select: { id: true, propertyId: true, status: true },
    });
    if (!current) throw new HospitalityInventoryUnavailableError('Rate plan is not active for this property.');
    const assignmentCount = await transaction.hospitalityRoomTypeRatePlan.count({
      where: { organizationId: input.organizationId, propertyId: input.propertyId, ratePlanId: current.id },
    });
    if (assignmentCount > 0) throw new HospitalityInventoryDependencyError('Remove all room-type assignments before archiving the rate plan.');
    const activeRestrictions = await transaction.hospitalityRestriction.count({
      where: { organizationId: input.organizationId, propertyId: input.propertyId, ratePlanId: current.id, status: 'ACTIVE' },
    });
    if (activeRestrictions > 0) throw new HospitalityInventoryDependencyError('Archive active restrictions before archiving the rate plan.');
    const archivedAt = new Date();
    const updated = await transaction.hospitalityRatePlan.update({
      where: { id_propertyId_organizationId: { id: current.id, propertyId: input.propertyId, organizationId: input.organizationId } },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rate-plan.archived',
        resourceType: 'hospitality-rate-plan',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
