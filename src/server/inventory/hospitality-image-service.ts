import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { assertHospitalityImageRemoveConfirmation, normalizeHospitalityImageInput, type HospitalityImageInput } from './hospitality-image-domain.ts';
import { resolveInventoryPagination } from './inventory-pagination.ts';
import { HospitalityInventoryConflictError, HospitalityInventoryUnavailableError } from './hospitality-service.ts';

type ImageScope = {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  roomTypeId?: string;
};

type ImagePageScope = ImageScope & {
  page?: number;
  pageSize?: number;
};

function hospitalityImageMutationLockKey(input: ImageScope) {
  return ['sf', 'hospitality-image', input.organizationId, input.propertyId, input.roomTypeId ?? 'property'].join(':');
}

async function requireImageReadScope(input: ImageScope) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  if (input.roomTypeId) assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
}

async function requireImageScope(input: ImageScope) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  if (input.roomTypeId) assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
}

export async function listHospitalityImagesPage(input: ImagePageScope) {
  await requireImageReadScope(input);

  if (input.roomTypeId) {
    const where = { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId };
    return db.$transaction(async (transaction) => {
      const total = await transaction.hospitalityRoomTypeImage.count({ where });
      const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
      const images = await transaction.hospitalityRoomTypeImage.findMany({
        where,
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      });
      return { images, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
    }, { isolationLevel: 'RepeatableRead' });
  }

  const where = { organizationId: input.organizationId, propertyId: input.propertyId };
  return db.$transaction(async (transaction) => {
    const total = await transaction.hospitalityPropertyImage.count({ where });
    const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
    const images = await transaction.hospitalityPropertyImage.findMany({
      where,
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
    });
    return { images, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function createHospitalityImage(input: ImageScope & { image: HospitalityImageInput }) {
  await requireImageScope(input);
  const image = normalizeHospitalityImageInput(input.image);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityImageMutationLockKey(input)}, 0))`;
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
      const imageCount = await transaction.hospitalityRoomTypeImage.count({ where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId } });
      const isPrimary = image.isPrimary || imageCount === 0;
      if (isPrimary) {
        await transaction.hospitalityRoomTypeImage.updateMany({
          where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const created = await transaction.hospitalityRoomTypeImage.create({
        data: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId, ...image, isPrimary },
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
    const imageCount = await transaction.hospitalityPropertyImage.count({ where: { organizationId: input.organizationId, propertyId: input.propertyId } });
    const isPrimary = image.isPrimary || imageCount === 0;
    if (isPrimary) {
      await transaction.hospitalityPropertyImage.updateMany({
        where: { organizationId: input.organizationId, propertyId: input.propertyId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    const created = await transaction.hospitalityPropertyImage.create({
      data: { organizationId: input.organizationId, propertyId: input.propertyId, ...image, isPrimary },
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
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityImageMutationLockKey(input)}, 0))`;
    if (input.roomTypeId) {
      const current = await transaction.hospitalityRoomTypeImage.findFirst({
        where: {
          id: input.imageId,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          roomTypeId: input.roomTypeId,
          roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
        },
      });
      if (!current) throw new HospitalityInventoryUnavailableError('Image is not available in an active inventory scope.');
      if (current.isPrimary) return current;
      await transaction.hospitalityRoomTypeImage.updateMany({
        where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId, isPrimary: true },
        data: { isPrimary: false },
      });
      const updated = await transaction.hospitalityRoomTypeImage.update({
        where: { id: current.id, organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId },
        data: { isPrimary: true },
      });
      await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.image.primary-room-type', resourceType: 'hospitality-room-type-image', resourceId: current.id, afterData: { propertyId: input.propertyId, roomTypeId: input.roomTypeId, isPrimary: true } } });
      return updated;
    }

    const current = await transaction.hospitalityPropertyImage.findFirst({
      where: { id: input.imageId, organizationId: input.organizationId, propertyId: input.propertyId, property: { is: { status: 'ACTIVE' } } },
    });
    if (!current) throw new HospitalityInventoryUnavailableError('Image is not available in an active inventory scope.');
    if (current.isPrimary) return current;
    await transaction.hospitalityPropertyImage.updateMany({ where: { organizationId: input.organizationId, propertyId: input.propertyId, isPrimary: true }, data: { isPrimary: false } });
    const updated = await transaction.hospitalityPropertyImage.update({
      where: { id: current.id, organizationId: input.organizationId, propertyId: input.propertyId },
      data: { isPrimary: true },
    });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.image.primary-property', resourceType: 'hospitality-property-image', resourceId: current.id, afterData: { propertyId: input.propertyId, isPrimary: true } } });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function removeHospitalityImage(input: ImageScope & { imageId: string; confirmation: string }) {
  await requireImageScope(input);
  assertUuidIdentifier(input.imageId, 'imageId');
  assertHospitalityImageRemoveConfirmation(input.confirmation);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityImageMutationLockKey(input)}, 0))`;
    if (input.roomTypeId) {
      const current = await transaction.hospitalityRoomTypeImage.findFirst({
        where: {
          id: input.imageId,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          roomTypeId: input.roomTypeId,
          roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
        },
      });
      if (!current) throw new HospitalityInventoryUnavailableError('Image is not available in an active inventory scope.');
      await transaction.hospitalityRoomTypeImage.delete({
        where: { id: current.id, organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId },
      });
      let promotedImageId: string | null = null;
      if (current.isPrimary) {
        const replacement = await transaction.hospitalityRoomTypeImage.findFirst({
          where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (replacement) {
          await transaction.hospitalityRoomTypeImage.updateMany({
            where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId, isPrimary: true },
            data: { isPrimary: false },
          });
          await transaction.hospitalityRoomTypeImage.update({
            where: { id: replacement.id, organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId },
            data: { isPrimary: true },
          });
          promotedImageId = replacement.id;
        }
      }
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.image.removed-room-type',
          resourceType: 'hospitality-room-type-image',
          resourceId: current.id,
          beforeData: { propertyId: input.propertyId, roomTypeId: input.roomTypeId, isPrimary: current.isPrimary, sortOrder: current.sortOrder },
          afterData: promotedImageId ? { promotedImageId } : {},
        },
      });
      return current;
    }

    const current = await transaction.hospitalityPropertyImage.findFirst({ where: { id: input.imageId, organizationId: input.organizationId, propertyId: input.propertyId, property: { is: { status: 'ACTIVE' } } } });
    if (!current) throw new HospitalityInventoryUnavailableError('Image is not available in an active inventory scope.');
    await transaction.hospitalityPropertyImage.delete({
      where: { id: current.id, organizationId: input.organizationId, propertyId: input.propertyId },
    });
    let promotedImageId: string | null = null;
    if (current.isPrimary) {
      const replacement = await transaction.hospitalityPropertyImage.findFirst({
        where: { organizationId: input.organizationId, propertyId: input.propertyId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (replacement) {
        await transaction.hospitalityPropertyImage.updateMany({
          where: { organizationId: input.organizationId, propertyId: input.propertyId, isPrimary: true },
          data: { isPrimary: false },
        });
        await transaction.hospitalityPropertyImage.update({
          where: { id: replacement.id, organizationId: input.organizationId, propertyId: input.propertyId },
          data: { isPrimary: true },
        });
        promotedImageId = replacement.id;
      }
    }
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.image.removed-property',
        resourceType: 'hospitality-property-image',
        resourceId: current.id,
        beforeData: { propertyId: input.propertyId, isPrimary: current.isPrimary, sortOrder: current.sortOrder },
        afterData: promotedImageId ? { promotedImageId } : {},
      },
    });
    return current;
  }, { isolationLevel: 'Serializable' });
}
