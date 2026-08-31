import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { assertInventoryArchiveConfirmation, normalizeAmenityInput, type AmenityInput } from './hospitality-domain.ts';
import { listAmenitiesForOrganization, listPropertyAmenities, listRoomTypeAmenities } from './hospitality-amenity-repository.ts';
import { HospitalityInventoryConflictError, HospitalityInventoryDependencyError, HospitalityInventoryUnavailableError } from './hospitality-service.ts';

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

export async function archiveHospitalityAmenity(input: { organizationId: string; actorUserId: string; amenityId: string; confirmation: string }) {
  assertUuidIdentifier(input.amenityId, 'amenityId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:manage' });
  assertInventoryArchiveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    const current = await transaction.hospitalityAmenity.findFirst({ where: { id: input.amenityId, organizationId: input.organizationId, status: 'ACTIVE' }, select: { id: true, status: true } });
    if (!current) throw new HospitalityInventoryUnavailableError('Amenity is not available in this organization.');
    const [propertyAssignments, roomTypeAssignments] = await Promise.all([
      transaction.hospitalityPropertyAmenity.count({ where: { organizationId: input.organizationId, amenityId: current.id } }),
      transaction.hospitalityRoomTypeAmenity.count({ where: { organizationId: input.organizationId, amenityId: current.id } }),
    ]);
    if (propertyAssignments + roomTypeAssignments > 0) {
      throw new HospitalityInventoryDependencyError('Remove amenity assignments before archiving the amenity.');
    }
    const archivedAt = new Date();
    const updated = await transaction.hospitalityAmenity.update({ where: { id: current.id }, data: { status: 'ARCHIVED', archivedAt } });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'inventory.amenity.archived', resourceType: 'hospitality-amenity', resourceId: current.id, beforeData: { status: current.status }, afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() } } });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
