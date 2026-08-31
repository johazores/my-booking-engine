import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { effectiveWindowCapacity } from './availability-window-domain.ts';
import {
  evaluateAvailabilityRestrictions,
  normalizeAvailabilityRequest,
  type AvailabilityRequestInput,
} from './availability-domain.ts';

export class AvailabilityUnavailableError extends Error {
  constructor(message = 'Availability scope is not available in this organization.') {
    super(message);
    this.name = 'AvailabilityUnavailableError';
  }
}

export async function readHospitalityAvailability(input: {
  organizationId: string;
  actorUserId: string;
  request: AvailabilityRequestInput;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'availability:read',
  });

  const request = normalizeAvailabilityRequest(input.request);
  assertUuidIdentifier(request.propertyId, 'propertyId');
  assertUuidIdentifier(request.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(request.ratePlanId, 'ratePlanId');

  const assignment = await db.hospitalityRoomTypeRatePlan.findFirst({
    where: {
      organizationId: input.organizationId,
      propertyId: request.propertyId,
      roomTypeId: request.roomTypeId,
      ratePlanId: request.ratePlanId,
      roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
      ratePlan: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
    },
    include: {
      roomType: { select: { id: true, name: true, code: true } },
      ratePlan: { select: { id: true, name: true, code: true } },
    },
  });
  if (!assignment) throw new AvailabilityUnavailableError('Room type and rate plan must be active and assigned within the same property.');

  const [physicalCapacity, restrictions, windows] = await Promise.all([
    db.hospitalityRoom.count({
      where: { organizationId: input.organizationId, propertyId: request.propertyId, roomTypeId: request.roomTypeId, status: 'ACTIVE' },
    }),
    db.hospitalityRestriction.findMany({
      where: {
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        ratePlanId: request.ratePlanId,
        status: 'ACTIVE',
        startDate: { lte: request.departureDate },
        endDate: { gte: request.arrivalDate },
        OR: [{ roomTypeId: null }, { roomTypeId: request.roomTypeId }],
      },
      select: { startDate: true, endDate: true, minStayNights: true, maxStayNights: true, closedToArrival: true, closedToDeparture: true },
    }),
    db.hospitalityAvailabilityWindow.findMany({
      where: {
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        roomTypeId: request.roomTypeId,
        status: 'ACTIVE',
        startDate: { lt: request.departureDate },
        endDate: { gte: request.arrivalDate },
      },
      select: { startDate: true, endDate: true, capacityLimit: true },
    }),
  ]);

  const restrictionResult = evaluateAvailabilityRestrictions({ arrivalDate: request.arrivalDate, departureDate: request.departureDate, stayNights: request.stayNights, restrictions });
  const sellableCapacity = effectiveWindowCapacity({ physicalCapacity, arrivalDate: request.arrivalDate, departureDate: request.departureDate, windows });
  const capacityAvailable = sellableCapacity >= request.quantity;

  return {
    scope: { propertyId: request.propertyId, roomType: assignment.roomType, ratePlan: assignment.ratePlan },
    stay: { arrivalDate: request.arrivalDate, departureDate: request.departureDate, nights: request.stayNights, quantity: request.quantity },
    capacity: {
      physicalUnits: physicalCapacity,
      sellableUnits: sellableCapacity,
      requestedUnits: request.quantity,
      remainingUnits: Math.max(0, sellableCapacity - request.quantity),
      source: windows.length > 0 ? 'PHYSICAL_ROOMS_WITH_WINDOWS' as const : 'ACTIVE_PHYSICAL_ROOMS' as const,
      windowCount: windows.length,
    },
    restrictions: restrictionResult,
    available: capacityAvailable && restrictionResult.allowed,
    unavailableReasons: [...(capacityAvailable ? [] : ['insufficient-capacity']), ...restrictionResult.reasons],
  };
}
