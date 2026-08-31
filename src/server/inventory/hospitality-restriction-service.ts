import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { assertInventoryArchiveConfirmation } from './hospitality-domain.ts';
import {
  formatRestrictionDate,
  normalizeHospitalityRestrictionInput,
  type HospitalityRestrictionInput,
} from './hospitality-restriction-domain.ts';
import {
  HospitalityInventoryConflictError,
  HospitalityInventoryUnavailableError,
} from './hospitality-service.ts';

export async function listHospitalityRestrictions(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  ratePlanId: string;
  roomTypeId: string | null;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.ratePlanId, 'ratePlanId');
  if (input.roomTypeId) assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });

  const ratePlan = await db.hospitalityRatePlan.findFirst({
    where: { id: input.ratePlanId, propertyId: input.propertyId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!ratePlan) throw new HospitalityInventoryUnavailableError('Rate plan is not available for this property.');

  const where = {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    ratePlanId: input.ratePlanId,
    roomTypeId: input.roomTypeId,
  };
  const total = await db.hospitalityRestriction.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const restrictions = await db.hospitalityRestriction.findMany({
    where,
    orderBy: [{ status: 'asc' }, { startDate: 'asc' }, { endDate: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
  });
  return { restrictions, total, page, totalPages };
}

export async function listHospitalityRestrictionRoomTypeScopes(input: {
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

  const where = { organizationId: input.organizationId, propertyId: input.propertyId, ratePlanId: input.ratePlanId };
  const total = await db.hospitalityRoomTypeRatePlan.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const assignments = await db.hospitalityRoomTypeRatePlan.findMany({
    where,
    orderBy: [{ roomType: { name: 'asc' } }, { roomTypeId: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
    include: { roomType: { select: { id: true, name: true, code: true, status: true } } },
  });
  return { assignments, total, page, totalPages };
}

export async function readHospitalityRestrictionRoomTypeScope(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  ratePlanId: string;
  roomTypeId: string;
}) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.ratePlanId, 'ratePlanId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
  const assignment = await db.hospitalityRoomTypeRatePlan.findFirst({
    where: {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      ratePlanId: input.ratePlanId,
      roomTypeId: input.roomTypeId,
    },
    include: { roomType: { select: { id: true, name: true, code: true, status: true } } },
  });
  return assignment?.roomType ?? null;
}

export async function createHospitalityRestriction(input: {
  organizationId: string;
  actorUserId: string;
  restriction: HospitalityRestrictionInput;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  const restriction = normalizeHospitalityRestrictionInput(input.restriction);
  assertUuidIdentifier(restriction.propertyId, 'propertyId');
  assertUuidIdentifier(restriction.ratePlanId, 'ratePlanId');
  if (restriction.roomTypeId) assertUuidIdentifier(restriction.roomTypeId, 'roomTypeId');

  return db.$transaction(async (transaction) => {
    const ratePlan = await transaction.hospitalityRatePlan.findFirst({
      where: {
        id: restriction.ratePlanId,
        propertyId: restriction.propertyId,
        organizationId: input.organizationId,
        status: 'ACTIVE',
        property: { is: { status: 'ACTIVE' } },
      },
      select: { id: true },
    });
    if (!ratePlan) throw new HospitalityInventoryUnavailableError('Rate plan is not active for this property.');

    if (restriction.roomTypeId) {
      const assignment = await transaction.hospitalityRoomTypeRatePlan.findFirst({
        where: {
          organizationId: input.organizationId,
          propertyId: restriction.propertyId,
          ratePlanId: restriction.ratePlanId,
          roomTypeId: restriction.roomTypeId,
          roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
        },
        select: { roomTypeId: true },
      });
      if (!assignment) {
        throw new HospitalityInventoryUnavailableError('Room type must be active and assigned to this rate plan before adding a restriction.');
      }
    }

    const overlap = await transaction.hospitalityRestriction.findFirst({
      where: {
        organizationId: input.organizationId,
        propertyId: restriction.propertyId,
        ratePlanId: restriction.ratePlanId,
        roomTypeId: restriction.roomTypeId,
        status: 'ACTIVE',
        startDate: { lte: restriction.endDate },
        endDate: { gte: restriction.startDate },
      },
      select: { id: true },
    });
    if (overlap) {
      throw new HospitalityInventoryConflictError('An active restriction already overlaps this scope and date range.');
    }

    const created = await transaction.hospitalityRestriction.create({
      data: { organizationId: input.organizationId, ...restriction },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.restriction.created',
        resourceType: 'hospitality-restriction',
        resourceId: created.id,
        afterData: {
          propertyId: created.propertyId,
          ratePlanId: created.ratePlanId,
          roomTypeId: created.roomTypeId,
          startDate: formatRestrictionDate(created.startDate),
          endDate: formatRestrictionDate(created.endDate),
          minStayNights: created.minStayNights,
          maxStayNights: created.maxStayNights,
          closedToArrival: created.closedToArrival,
          closedToDeparture: created.closedToDeparture,
          status: created.status,
        },
      },
    });
    return created;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveHospitalityRestriction(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  ratePlanId: string;
  restrictionId: string;
  confirmation: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.ratePlanId, 'ratePlanId');
  assertUuidIdentifier(input.restrictionId, 'restrictionId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  assertInventoryArchiveConfirmation(input.confirmation);

  return db.$transaction(async (transaction) => {
    const current = await transaction.hospitalityRestriction.findFirst({
      where: {
        id: input.restrictionId,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        ratePlanId: input.ratePlanId,
        status: 'ACTIVE',
        ratePlan: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
      },
      select: { id: true, status: true },
    });
    if (!current) throw new HospitalityInventoryUnavailableError('Restriction is not active for this property and rate plan.');

    const archivedAt = new Date();
    const updated = await transaction.hospitalityRestriction.update({
      where: { id_propertyId_organizationId: { id: current.id, propertyId: input.propertyId, organizationId: input.organizationId } },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.restriction.archived',
        resourceType: 'hospitality-restriction',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
