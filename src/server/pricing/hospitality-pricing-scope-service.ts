import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { HospitalityPricingUnavailableError } from './hospitality-pricing-service.ts';

export async function listHospitalityPricingScopes(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' });
  const where = {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    roomType: { status: 'ACTIVE' as const },
    ratePlan: { status: 'ACTIVE' as const },
  };
  const total = await db.hospitalityRoomTypeRatePlan.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(Math.max(1, input.page), totalPages);
  const scopes = await db.hospitalityRoomTypeRatePlan.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { roomTypeId: 'asc' }, { ratePlanId: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
    include: {
      roomType: { select: { id: true, name: true, code: true } },
      ratePlan: { select: { id: true, name: true, code: true } },
    },
  });
  return { scopes, total, page, totalPages };
}

export async function readHospitalityPricingScope(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
}) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(input.ratePlanId, 'ratePlanId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' });
  const scope = await db.hospitalityRoomTypeRatePlan.findFirst({
    where: {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      roomTypeId: input.roomTypeId,
      ratePlanId: input.ratePlanId,
      roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
      ratePlan: { is: { status: 'ACTIVE' } },
    },
    include: {
      roomType: { select: { id: true, name: true, code: true } },
      ratePlan: { select: { id: true, name: true, code: true } },
    },
  });
  if (!scope) throw new HospitalityPricingUnavailableError('Pricing scope is not available for active inventory.');
  return scope;
}
