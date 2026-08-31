import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { normalizeAmenityInput, type AmenityInput } from './hospitality-domain.ts';
import { listAmenitiesForOrganization, listPropertyAmenities, listRoomTypeAmenities } from './hospitality-amenity-repository.ts';
import { HospitalityInventoryConflictError } from './hospitality-service.ts';

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function listHospitalityAmenities(input: { organizationId: string; actorUserId: string }) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
  return listAmenitiesForOrganization(input);
}

export async function listHospitalityPropertyAmenities(input: { organizationId: string; actorUserId: string; propertyId: string }) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
  return listPropertyAmenities(input);
}

export async function listHospitalityRoomTypeAmenities(input: { organizationId: string; actorUserId: string; propertyId: string; roomTypeId: string }) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' });
  return listRoomTypeAmenities(input);
}

export async function createHospitalityAmenity(input: { organizationId: string; actorUserId: string; amenity: AmenityInput }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  const amenity = normalizeAmenityInput(input.amenity);
  try {
    return await db.$transaction(async (transaction) => {
      const created = await transaction.hospitalityAmenity.create({ data: { organizationId: input.organizationId, ...amenity } });
      await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.amenity.created', resourceType: 'hospitality-amenity', resourceId: created.id, afterData: { code: created.code, status: created.status } } });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new HospitalityInventoryConflictError('An amenity with that code already exists in this organization.');
    throw error;
  }
}
