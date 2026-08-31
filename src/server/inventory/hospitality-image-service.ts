import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { normalizeHospitalityImageInput, type HospitalityImageInput } from './hospitality-image-domain.ts';
import { HospitalityInventoryConflictError, HospitalityInventoryUnavailableError } from './hospitality-service.ts';

const IMAGE_LIMIT = 50;

type ImageScope = {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  roomTypeId?: string;
};

async function requireImageScope(input: ImageScope) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  if (input.roomTypeId) assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
}

export async function listHospitalityImages(input: ImageScope) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  if (input.roomTypeId) assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });

  if (input.roomTypeId) {
    return db.hospitalityRoomTypeImage.findMany({
      where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: IMAGE_LIMIT,
    });
  }

  return db.hospitalityPropertyImage.findMany({
    where: { organizationId: input.organizationId, propertyId: input.propertyId },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: IMAGE_LIMIT,
  });
}

export async function createHospitalityImage(input: ImageScope & { image: HospitalityImageInput }) {
  await requireImageScope(input);
  const image = normalizeHospitalityImageInput(input.image);

  return db.$transaction(async (transaction) => {
    const property = await transaction.hospitalityProperty.findFirst({
      where: { id: input.propertyId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!property) throw new HospitalityInventoryUnavailableError('Property is not available in this organization.');

    if (input.roomTypeId) {
      const roomType = await transaction.hospitalityRoomType.findFirst({
        where: { id: input.roomTypeId, propertyId: input.propertyId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!roomType) throw new HospitalityInventoryUnavailableError('Room type is not available for this property.');
      const duplicate = await transaction.hospitalityRoomTypeImage.findFirst({
        where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId, url: image.url },
        select: { id: true },
      });
      if (duplicate) throw new HospitalityInventoryConflictError('That image URL is already assigned to this room type.');
      if (image.isPrimary) {
        await transaction.hospitalityRoomTypeImage.updateMany({
          where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const created = await transaction.hospitalityRoomTypeImage.create({
        data: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId, ...image },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.image.created-room-type',
          resourceType: 'hospitality-room-type-image',
          resourceId: created.id,
          afterData: { propertyId: input.propertyId, roomTypeId: input.roomTypeId, isPrimary: created.isPrimary, sortOrder: created.sortOrder },
        },
      });
      return created;
    }

    const duplicate = await transaction.hospitalityPropertyImage.findFirst({
      where: { organizationId: input.organizationId, propertyId: input.propertyId, url: image.url },
      select: { id: true },
    });
    if (duplicate) throw new HospitalityInventoryConflictError('That image URL is already assigned to this property.');
    if (image.isPrimary) {
      await transaction.hospitalityPropertyImage.updateMany({
        where: { organizationId: input.organizationId, propertyId: input.propertyId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    const created = await transaction.hospitalityPropertyImage.create({
      data: { organizationId: input.organizationId, propertyId: input.propertyId, ...image },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.image.created-property',
        resourceType: 'hospitality-property-image',
        resourceId: created.id,
        afterData: { propertyId: input.propertyId, isPrimary: created.isPrimary, sortOrder: created.sortOrder },
      },
    });
    return created;
  }, { isolationLevel: 'Serializable' });
}

export async function setPrimaryHospitalityImage(input: ImageScope & { imageId: string }) {
  await requireImageScope(input);
  assertUuidIdentifier(input.imageId, 'imageId');

  return db.$transaction(async (transaction) => {
    if (input.roomTypeId) {
      const current = await transaction.hospitalityRoomTypeImage.findFirst({
        where: { id: input.imageId, organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId },
      });
      if (!current) throw new HospitalityInventoryUnavailableError('Image is not available in this organization.');
      if (current.isPrimary) return current;
      await transaction.hospitalityRoomTypeImage.updateMany({
        where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId, isPrimary: true },
        data: { isPrimary: false },
      });
      const updated = await transaction.hospitalityRoomTypeImage.update({ where: { id: current.id }, data: { isPrimary: true } });
      await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.image.primary-room-type', resourceType: 'hospitality-room-type-image', resourceId: current.id, afterData: { propertyId: input.propertyId, roomTypeId: input.roomTypeId, isPrimary: true } } });
      return updated;
    }

    const current = await transaction.hospitalityPropertyImage.findFirst({
      where: { id: input.imageId, organizationId: input.organizationId, propertyId: input.propertyId },
    });
    if (!current) throw new HospitalityInventoryUnavailableError('Image is not available in this organization.');
    if (current.isPrimary) return current;
    await transaction.hospitalityPropertyImage.updateMany({ where: { organizationId: input.organizationId, propertyId: input.propertyId, isPrimary: true }, data: { isPrimary: false } });
    const updated = await transaction.hospitalityPropertyImage.update({ where: { id: current.id }, data: { isPrimary: true } });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.image.primary-property', resourceType: 'hospitality-property-image', resourceId: current.id, afterData: { propertyId: input.propertyId, isPrimary: true } } });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function removeHospitalityImage(input: ImageScope & { imageId: string }) {
  await requireImageScope(input);
  assertUuidIdentifier(input.imageId, 'imageId');

  return db.$transaction(async (transaction) => {
    if (input.roomTypeId) {
      const current = await transaction.hospitalityRoomTypeImage.findFirst({ where: { id: input.imageId, organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId } });
      if (!current) throw new HospitalityInventoryUnavailableError('Image is not available in this organization.');
      await transaction.hospitalityRoomTypeImage.delete({ where: { id: current.id } });
      await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.image.removed-room-type', resourceType: 'hospitality-room-type-image', resourceId: current.id, beforeData: { propertyId: input.propertyId, roomTypeId: input.roomTypeId, isPrimary: current.isPrimary, sortOrder: current.sortOrder } } });
      return current;
    }

    const current = await transaction.hospitalityPropertyImage.findFirst({ where: { id: input.imageId, organizationId: input.organizationId, propertyId: input.propertyId } });
    if (!current) throw new HospitalityInventoryUnavailableError('Image is not available in this organization.');
    await transaction.hospitalityPropertyImage.delete({ where: { id: current.id } });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.image.removed-property', resourceType: 'hospitality-property-image', resourceId: current.id, beforeData: { propertyId: input.propertyId, isPrimary: current.isPrimary, sortOrder: current.sortOrder } } });
    return current;
  }, { isolationLevel: 'Serializable' });
}
