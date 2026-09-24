import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { resolveInventoryPagination } from './inventory-pagination.ts';

export async function listHospitalityPropertiesForOrganization(input: { organizationId: string; page: number; pageSize: number }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const where = { organizationId: input.organizationId };

  return db.$transaction(async (transaction) => {
    const total = await transaction.hospitalityProperty.count({ where });
    const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
    const properties = await transaction.hospitalityProperty.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: { _count: { select: { roomTypes: true } } },
    });
    return { properties, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function readPropertyForOrganization(input: { organizationId: string; propertyId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  return db.hospitalityProperty.findFirst({ where: { id: input.propertyId, organizationId: input.organizationId } });
}

export async function listRoomTypesForProperty(input: { organizationId: string; propertyId: string; page: number; pageSize: number }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  const where = { organizationId: input.organizationId, propertyId: input.propertyId };

  return db.$transaction(async (transaction) => {
    const total = await transaction.hospitalityRoomType.count({ where });
    const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
    const roomTypes = await transaction.hospitalityRoomType.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: { _count: { select: { rooms: true } } },
    });
    return { roomTypes, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function readRoomTypeForOrganization(input: { organizationId: string; roomTypeId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  return db.hospitalityRoomType.findFirst({ where: { id: input.roomTypeId, organizationId: input.organizationId } });
}

export async function listRoomsForRoomType(input: { organizationId: string; propertyId: string; roomTypeId: string; page: number; pageSize: number }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  const where = { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId };

  return db.$transaction(async (transaction) => {
    const total = await transaction.hospitalityRoom.count({ where });
    const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
    const rooms = await transaction.hospitalityRoom.findMany({
      where,
      orderBy: [{ status: 'asc' }, { code: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
    });
    return { rooms, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}
