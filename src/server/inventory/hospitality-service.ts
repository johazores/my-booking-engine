import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  assertInventoryArchiveConfirmation,
  normalizePropertyInput,
  normalizeRoomInput,
  normalizeRoomTypeInput,
  type PropertyInput,
  type RoomInput,
  type RoomTypeInput,
} from './hospitality-domain.ts';
import {
  listHospitalityPropertiesForOrganization,
  listRoomTypesForProperty,
  listRoomsForRoomType,
  readPropertyForOrganization,
  readRoomTypeForOrganization,
} from './hospitality-repository.ts';

export class HospitalityInventoryConflictError extends Error {
  constructor(message = 'An inventory record with that code already exists in this scope.') {
    super(message);
    this.name = 'HospitalityInventoryConflictError';
  }
}

export class HospitalityInventoryUnavailableError extends Error {
  constructor(message = 'Inventory record is not available in this organization.') {
    super(message);
    this.name = 'HospitalityInventoryUnavailableError';
  }
}

export class HospitalityInventoryDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityInventoryDependencyError';
  }
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function listHospitalityProperties(input: { organizationId: string; actorUserId: string; page: number; pageSize: number }) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
  return listHospitalityPropertiesForOrganization(input);
}

export async function readHospitalityProperty(input: { organizationId: string; actorUserId: string; propertyId: string }) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
  return readPropertyForOrganization({ organizationId: input.organizationId, propertyId: input.propertyId });
}

export async function listHospitalityRoomTypes(input: { organizationId: string; actorUserId: string; propertyId: string; page: number; pageSize: number }) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
  return listRoomTypesForProperty(input);
}

export async function readHospitalityRoomType(input: { organizationId: string; actorUserId: string; roomTypeId: string }) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
  return readRoomTypeForOrganization({ organizationId: input.organizationId, roomTypeId: input.roomTypeId });
}

export async function listHospitalityRooms(input: { organizationId: string; actorUserId: string; propertyId: string; roomTypeId: string; page: number; pageSize: number }) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
  return listRoomsForRoomType(input);
}

export async function createHospitalityProperty(input: { organizationId: string; actorUserId: string; property: PropertyInput }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  const property = normalizePropertyInput(input.property);
  try {
    return await db.$transaction(async (transaction) => {
      const created = await transaction.hospitalityProperty.create({ data: { organizationId: input.organizationId, ...property } });
      await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.property.created', resourceType: 'hospitality-property', resourceId: created.id, afterData: { code: created.code, status: created.status } } });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new HospitalityInventoryConflictError('A property with that code already exists in this organization.');
    throw error;
  }
}

export async function createHospitalityRoomType(input: { organizationId: string; actorUserId: string; roomType: RoomTypeInput }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  const roomType = normalizeRoomTypeInput(input.roomType);
  assertUuidIdentifier(roomType.propertyId, 'propertyId');
  try {
    return await db.$transaction(async (transaction) => {
      const property = await transaction.hospitalityProperty.findFirst({ where: { id: roomType.propertyId, organizationId: input.organizationId, status: 'ACTIVE' }, select: { id: true } });
      if (!property) throw new HospitalityInventoryUnavailableError('Property is not available in this organization.');
      const created = await transaction.hospitalityRoomType.create({ data: { organizationId: input.organizationId, ...roomType } });
      await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.room-type.created', resourceType: 'hospitality-room-type', resourceId: created.id, afterData: { propertyId: created.propertyId, code: created.code, status: created.status } } });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new HospitalityInventoryConflictError('A room type with that code already exists for this property.');
    throw error;
  }
}

export async function createHospitalityRoom(input: { organizationId: string; actorUserId: string; room: RoomInput }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  const room = normalizeRoomInput(input.room);
  assertUuidIdentifier(room.propertyId, 'propertyId');
  assertUuidIdentifier(room.roomTypeId, 'roomTypeId');
  try {
    return await db.$transaction(async (transaction) => {
      const roomType = await transaction.hospitalityRoomType.findFirst({ where: { id: room.roomTypeId, propertyId: room.propertyId, organizationId: input.organizationId, status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } }, select: { id: true } });
      if (!roomType) throw new HospitalityInventoryUnavailableError('Room type is not available for this property.');
      const created = await transaction.hospitalityRoom.create({ data: { organizationId: input.organizationId, ...room } });
      await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.room.created', resourceType: 'hospitality-room', resourceId: created.id, afterData: { propertyId: created.propertyId, roomTypeId: created.roomTypeId, code: created.code, status: created.status } } });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new HospitalityInventoryConflictError('A room with that code already exists for this property.');
    throw error;
  }
}

async function archiveInventoryRecord(input: { organizationId: string; actorUserId: string; resourceId: string; confirmation: string; kind: 'property' | 'room-type' | 'room' }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.resourceId, 'resourceId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  assertInventoryArchiveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    const archivedAt = new Date();
    if (input.kind === 'property') {
      const current = await transaction.hospitalityProperty.findFirst({ where: { id: input.resourceId, organizationId: input.organizationId, status: 'ACTIVE' }, select: { id: true, status: true } });
      if (!current) throw new HospitalityInventoryUnavailableError();
      const activeChildren = await transaction.hospitalityRoomType.count({ where: { propertyId: current.id, organizationId: input.organizationId, status: 'ACTIVE' } });
      if (activeChildren > 0) throw new HospitalityInventoryDependencyError('Archive active room types before archiving the property.');
      const activeRatePlans = await transaction.hospitalityRatePlan.count({ where: { propertyId: current.id, organizationId: input.organizationId, status: 'ACTIVE' } });
      if (activeRatePlans > 0) throw new HospitalityInventoryDependencyError('Archive active rate plans before archiving the property.');
      const updated = await transaction.hospitalityProperty.update({ where: { id: current.id }, data: { status: 'ARCHIVED', archivedAt } });
      await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.property.archived', resourceType: 'hospitality-property', resourceId: current.id, beforeData: { status: current.status }, afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() } } });
      return updated;
    }
    if (input.kind === 'room-type') {
      const current = await transaction.hospitalityRoomType.findFirst({ where: { id: input.resourceId, organizationId: input.organizationId, status: 'ACTIVE' }, select: { id: true, status: true } });
      if (!current) throw new HospitalityInventoryUnavailableError();
      const activeChildren = await transaction.hospitalityRoom.count({ where: { roomTypeId: current.id, organizationId: input.organizationId, status: { not: 'ARCHIVED' } } });
      if (activeChildren > 0) throw new HospitalityInventoryDependencyError('Archive rooms before archiving the room type.');
      const ratePlanAssignments = await transaction.hospitalityRoomTypeRatePlan.count({ where: { roomTypeId: current.id, organizationId: input.organizationId } });
      if (ratePlanAssignments > 0) throw new HospitalityInventoryDependencyError('Remove rate plan assignments before archiving the room type.');
      const updated = await transaction.hospitalityRoomType.update({ where: { id: current.id }, data: { status: 'ARCHIVED', archivedAt } });
      await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.room-type.archived', resourceType: 'hospitality-room-type', resourceId: current.id, beforeData: { status: current.status }, afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() } } });
      return updated;
    }
    const current = await transaction.hospitalityRoom.findFirst({ where: { id: input.resourceId, organizationId: input.organizationId, status: { not: 'ARCHIVED' } }, select: { id: true, roomTypeId: true, status: true } });
    if (!current) throw new HospitalityInventoryUnavailableError();
    const activeHolds = await transaction.hospitalityAvailabilityHold.count({ where: { organizationId: input.organizationId, roomTypeId: current.roomTypeId, status: 'ACTIVE', expiresAt: { gt: archivedAt } } });
    if (activeHolds > 0) throw new HospitalityInventoryDependencyError('Release or expire active availability holds before reducing physical room capacity.');
    const updated = await transaction.hospitalityRoom.update({ where: { id: current.id }, data: { status: 'ARCHIVED', archivedAt } });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.room.archived', resourceType: 'hospitality-room', resourceId: current.id, beforeData: { status: current.status }, afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() } } });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export const archiveHospitalityProperty = (input: { organizationId: string; actorUserId: string; propertyId: string; confirmation: string }) => archiveInventoryRecord({ ...input, resourceId: input.propertyId, kind: 'property' });
export const archiveHospitalityRoomType = (input: { organizationId: string; actorUserId: string; roomTypeId: string; confirmation: string }) => archiveInventoryRecord({ ...input, resourceId: input.roomTypeId, kind: 'room-type' });
export const archiveHospitalityRoom = (input: { organizationId: string; actorUserId: string; roomId: string; confirmation: string }) => archiveInventoryRecord({ ...input, resourceId: input.roomId, kind: 'room' });
