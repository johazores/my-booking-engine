import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';

export async function listHospitalityPropertiesForOrganization(input: { organizationId: string; page: number; pageSize: number }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const where = { organizationId: input.organizationId };
  const total = await db.hospitalityProperty.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const properties = await db.hospitalityProperty.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
    include: { _count: { select: { roomTypes: true } } },
  });
  return { properties, total, page, totalPages };
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
  const total = await db.hospitalityRoomType.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const roomTypes = await db.hospitalityRoomType.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
    include: { _count: { select: { rooms: true } } },
  });
  return { roomTypes, total, page, totalPages };
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
  const total = await db.hospitalityRoom.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const rooms = await db.hospitalityRoom.findMany({
    where,
    orderBy: [{ status: 'asc' }, { code: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
  });
  return { rooms, total, page, totalPages };
}
