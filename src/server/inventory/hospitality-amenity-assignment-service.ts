import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { HospitalityInventoryUnavailableError } from './hospitality-service.ts';

export async function assignHospitalityAmenityToProperty(input: { organizationId: string; actorUserId: string; propertyId: string; amenityId: string }) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.amenityId, 'amenityId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  return db.$transaction(async (transaction) => {
    const [property, amenity] = await Promise.all([
      transaction.hospitalityProperty.findFirst({ where: { id: input.propertyId, organizationId: input.organizationId, status: 'ACTIVE' }, select: { id: true } }),
      transaction.hospitalityAmenity.findFirst({ where: { id: input.amenityId, organizationId: input.organizationId, status: 'ACTIVE' }, select: { id: true } }),
    ]);
    if (!property || !amenity) throw new HospitalityInventoryUnavailableError('Property or amenity is not available in this organization.');
    const assignment = await transaction.hospitalityPropertyAmenity.upsert({
      where: { organizationId_propertyId_amenityId: { organizationId: input.organizationId, propertyId: property.id, amenityId: amenity.id } },
      create: { organizationId: input.organizationId, propertyId: property.id, amenityId: amenity.id },
      update: {},
    });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.amenity.assigned-property', resourceType: 'hospitality-amenity', resourceId: amenity.id, afterData: { propertyId: property.id } } });
    return assignment;
  }, { isolationLevel: 'Serializable' });
}

export async function removeHospitalityAmenityFromProperty(input: { organizationId: string; actorUserId: string; propertyId: string; amenityId: string }) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.amenityId, 'amenityId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  return db.$transaction(async (transaction) => {
    const assignment = await transaction.hospitalityPropertyAmenity.findUnique({ where: { organizationId_propertyId_amenityId: { organizationId: input.organizationId, propertyId: input.propertyId, amenityId: input.amenityId } } });
    if (!assignment) throw new HospitalityInventoryUnavailableError('Amenity assignment is not available in this organization.');
    await transaction.hospitalityPropertyAmenity.delete({ where: { organizationId_propertyId_amenityId: { organizationId: input.organizationId, propertyId: input.propertyId, amenityId: input.amenityId } } });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.amenity.removed-property', resourceType: 'hospitality-amenity', resourceId: input.amenityId, beforeData: { propertyId: input.propertyId } } });
  }, { isolationLevel: 'Serializable' });
}

export async function assignHospitalityAmenityToRoomType(input: { organizationId: string; actorUserId: string; propertyId: string; roomTypeId: string; amenityId: string }) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(input.amenityId, 'amenityId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  return db.$transaction(async (transaction) => {
    const [roomType, amenity] = await Promise.all([
      transaction.hospitalityRoomType.findFirst({ where: { id: input.roomTypeId, propertyId: input.propertyId, organizationId: input.organizationId, status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } }, select: { id: true, propertyId: true } }),
      transaction.hospitalityAmenity.findFirst({ where: { id: input.amenityId, organizationId: input.organizationId, status: 'ACTIVE' }, select: { id: true } }),
    ]);
    if (!roomType || !amenity) throw new HospitalityInventoryUnavailableError('Room type or amenity is not available in this organization.');
    const assignment = await transaction.hospitalityRoomTypeAmenity.upsert({
      where: { organizationId_roomTypeId_amenityId: { organizationId: input.organizationId, roomTypeId: roomType.id, amenityId: amenity.id } },
      create: { organizationId: input.organizationId, propertyId: roomType.propertyId, roomTypeId: roomType.id, amenityId: amenity.id },
      update: {},
    });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.amenity.assigned-room-type', resourceType: 'hospitality-amenity', resourceId: amenity.id, afterData: { propertyId: roomType.propertyId, roomTypeId: roomType.id } } });
    return assignment;
  }, { isolationLevel: 'Serializable' });
}

export async function removeHospitalityAmenityFromRoomType(input: { organizationId: string; actorUserId: string; propertyId: string; roomTypeId: string; amenityId: string }) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(input.amenityId, 'amenityId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  return db.$transaction(async (transaction) => {
    const assignment = await transaction.hospitalityRoomTypeAmenity.findFirst({ where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId, amenityId: input.amenityId } });
    if (!assignment) throw new HospitalityInventoryUnavailableError('Amenity assignment is not available in this organization.');
    await transaction.hospitalityRoomTypeAmenity.delete({ where: { organizationId_roomTypeId_amenityId: { organizationId: input.organizationId, roomTypeId: input.roomTypeId, amenityId: input.amenityId } } });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.amenity.removed-room-type', resourceType: 'hospitality-amenity', resourceId: input.amenityId, beforeData: { propertyId: input.propertyId, roomTypeId: input.roomTypeId } } });
  }, { isolationLevel: 'Serializable' });
}
