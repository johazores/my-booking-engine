import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';

export async function listAmenitiesForOrganization(input: { organizationId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  return db.hospitalityAmenity.findMany({
    where: { organizationId: input.organizationId },
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { propertyAssignments: true, roomTypeAssignments: true } } },
  });
}

export async function listPropertyAmenities(input: { organizationId: string; propertyId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  return db.hospitalityPropertyAmenity.findMany({
    where: { organizationId: input.organizationId, propertyId: input.propertyId },
    orderBy: { amenity: { name: 'asc' } },
    include: { amenity: true },
  });
}

export async function listRoomTypeAmenities(input: { organizationId: string; propertyId: string; roomTypeId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  return db.hospitalityRoomTypeAmenity.findMany({
    where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId },
    orderBy: { amenity: { name: 'asc' } },
    include: { amenity: true },
  });
}
