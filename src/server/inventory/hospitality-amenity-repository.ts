import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { resolveInventoryPagination } from './inventory-pagination.ts';

const MAX_COMPLETE_AMENITY_ROWS = 1_000;
const MAX_AMENITY_ASSIGNMENT_ROWS = 1_000;

function assertCompleteReadLimit(rows: unknown[], limit: number, label: string) {
  if (rows.length > limit) {
    throw new Error(`${label} exceeds the supported complete-read limit.`);
  }
}

export async function listAmenitiesForOrganizationPage(input: {
  organizationId: string;
  page?: number;
  pageSize?: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const where = { organizationId: input.organizationId };

  return db.$transaction(async (transaction) => {
    const total = await transaction.hospitalityAmenity.count({ where });
    const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
    const amenities = await transaction.hospitalityAmenity.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: { _count: { select: { propertyAssignments: true, roomTypeAssignments: true } } },
    });
    return { amenities, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function listAmenitiesForOrganization(input: { organizationId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const amenities = await db.hospitalityAmenity.findMany({
    where: { organizationId: input.organizationId, status: 'ACTIVE' },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: MAX_COMPLETE_AMENITY_ROWS + 1,
  });
  assertCompleteReadLimit(amenities, MAX_COMPLETE_AMENITY_ROWS, 'Active amenity catalog');
  return amenities;
}

export async function listPropertyAmenities(input: { organizationId: string; propertyId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  const assignments = await db.hospitalityPropertyAmenity.findMany({
    where: { organizationId: input.organizationId, propertyId: input.propertyId },
    orderBy: [{ amenity: { name: 'asc' } }, { amenityId: 'asc' }],
    include: { amenity: true },
    take: MAX_AMENITY_ASSIGNMENT_ROWS + 1,
  });
  assertCompleteReadLimit(assignments, MAX_AMENITY_ASSIGNMENT_ROWS, 'Property amenity assignments');
  return assignments;
}

export async function listRoomTypeAmenities(input: { organizationId: string; propertyId: string; roomTypeId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  const assignments = await db.hospitalityRoomTypeAmenity.findMany({
    where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId },
    orderBy: [{ amenity: { name: 'asc' } }, { amenityId: 'asc' }],
    include: { amenity: true },
    take: MAX_AMENITY_ASSIGNMENT_ROWS + 1,
  });
  assertCompleteReadLimit(assignments, MAX_AMENITY_ASSIGNMENT_ROWS, 'Room-type amenity assignments');
  return assignments;
}
