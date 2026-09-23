import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { INVENTORY_PAGE_SIZE_DEFAULT, INVENTORY_PAGE_SIZE_MAX } from './hospitality-domain.ts';

const MAX_COMPLETE_AMENITY_ROWS = 1_000;
const MAX_AMENITY_ASSIGNMENT_ROWS = 1_000;

function normalizePage(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : 1;
}

function normalizePageSize(value: number | undefined) {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) return INVENTORY_PAGE_SIZE_DEFAULT;
  return Math.min(value as number, INVENTORY_PAGE_SIZE_MAX);
}

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
  const pageSize = normalizePageSize(input.pageSize);
  const requestedPage = normalizePage(input.page);
  const where = { organizationId: input.organizationId };
  const total = await db.hospitalityAmenity.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const amenities = await db.hospitalityAmenity.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { _count: { select: { propertyAssignments: true, roomTypeAssignments: true } } },
  });
  return { amenities, total, page, totalPages, pageSize };
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
