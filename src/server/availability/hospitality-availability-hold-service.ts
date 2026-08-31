import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { hospitalityAvailabilityAllocationLockKey } from './availability-allocation-lock.ts';
import {
  availabilityHoldPayloadMatches,
  calculateAvailabilityHoldCapacity,
  normalizeAvailabilityHoldInput,
  type AvailabilityHoldInput,
} from './availability-hold-domain.ts';
import { evaluateAvailabilityRestrictions } from './availability-domain.ts';
import { AvailabilityUnavailableError } from './hospitality-availability-service.ts';

export class AvailabilityHoldConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvailabilityHoldConflictError';
  }
}

export class AvailabilityHoldUnavailableError extends Error {
  constructor(message = 'Availability hold is not available in this organization.') {
    super(message);
    this.name = 'AvailabilityHoldUnavailableError';
  }
}

export async function createHospitalityAvailabilityHold(input: {
  organizationId: string;
  actorUserId: string;
  hold: AvailabilityHoldInput;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:manage' });
  const normalized = normalizeAvailabilityHoldInput(input.hold);
  const request = normalized.request;
  assertUuidIdentifier(request.propertyId, 'propertyId');
  assertUuidIdentifier(request.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(request.ratePlanId, 'ratePlanId');
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityAvailabilityAllocationLockKey({ organizationId: input.organizationId, propertyId: request.propertyId, roomTypeId: request.roomTypeId })}, 0))`;

    const existing = await transaction.hospitalityAvailabilityHold.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: normalized.idempotencyKey } },
    });
    if (existing) {
      if (!availabilityHoldPayloadMatches({ hold: existing, request })) {
        throw new AvailabilityHoldConflictError('Idempotency key was already used for a different availability hold request.');
      }
      return existing;
    }

    const assignment = await transaction.hospitalityRoomTypeRatePlan.findFirst({
      where: {
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        roomTypeId: request.roomTypeId,
        ratePlanId: request.ratePlanId,
        roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
        ratePlan: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
      },
      select: { roomTypeId: true },
    });
    if (!assignment) throw new AvailabilityUnavailableError('Room type and rate plan must be active and assigned within the same property.');

    const [physicalCapacity, restrictions, windows, activeHolds] = await Promise.all([
      transaction.hospitalityRoom.count({ where: { organizationId: input.organizationId, propertyId: request.propertyId, roomTypeId: request.roomTypeId, status: 'ACTIVE' } }),
      transaction.hospitalityRestriction.findMany({
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
      transaction.hospitalityAvailabilityWindow.findMany({
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
      transaction.hospitalityAvailabilityHold.findMany({
        where: {
          organizationId: input.organizationId,
          propertyId: request.propertyId,
          roomTypeId: request.roomTypeId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
          arrivalDate: { lt: request.departureDate },
          departureDate: { gt: request.arrivalDate },
        },
        select: { arrivalDate: true, departureDate: true, quantity: true },
      }),
    ]);

    const restrictionResult = evaluateAvailabilityRestrictions({ arrivalDate: request.arrivalDate, departureDate: request.departureDate, stayNights: request.stayNights, restrictions });
    if (!restrictionResult.allowed) {
      throw new AvailabilityHoldUnavailableError(`Requested stay is restricted: ${restrictionResult.reasons.join(', ')}.`);
    }
    const capacity = calculateAvailabilityHoldCapacity({ physicalCapacity, arrivalDate: request.arrivalDate, departureDate: request.departureDate, windows, holds: activeHolds });
    if (capacity.sellableUnits < request.quantity) {
      throw new AvailabilityHoldUnavailableError('Requested units are no longer available for the full stay.');
    }

    const expiresAt = new Date(now.getTime() + normalized.expiresInMinutes * 60_000);
    const created = await transaction.hospitalityAvailabilityHold.create({
      data: {
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        roomTypeId: request.roomTypeId,
        ratePlanId: request.ratePlanId,
        idempotencyKey: normalized.idempotencyKey,
        arrivalDate: request.arrivalDate,
        departureDate: request.departureDate,
        quantity: request.quantity,
        expiresAt,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'availability.hold.created',
        resourceType: 'hospitality-availability-hold',
        resourceId: created.id,
        afterData: { propertyId: created.propertyId, roomTypeId: created.roomTypeId, ratePlanId: created.ratePlanId, quantity: created.quantity, expiresAt: created.expiresAt.toISOString() },
      },
    });
    return created;
  }, { isolationLevel: 'Serializable' });
}

export async function releaseHospitalityAvailabilityHold(input: {
  organizationId: string;
  actorUserId: string;
  holdId: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.holdId, 'holdId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:manage' });
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    const current = await transaction.hospitalityAvailabilityHold.findFirst({ where: { id: input.holdId, organizationId: input.organizationId } });
    if (!current) throw new AvailabilityHoldUnavailableError();
    if (current.status !== 'ACTIVE') return current;
    const status = current.expiresAt <= now ? 'EXPIRED' as const : 'RELEASED' as const;
    const updated = await transaction.hospitalityAvailabilityHold.update({ where: { id: current.id }, data: { status, endedAt: now } });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: status === 'EXPIRED' ? 'availability.hold.expired' : 'availability.hold.released',
        resourceType: 'hospitality-availability-hold',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status, endedAt: now.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function expireHospitalityAvailabilityHolds(input: {
  organizationId: string;
  actorUserId: string;
  now?: Date;
  limit?: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:manage' });
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);

  return db.$transaction(async (transaction) => {
    const expired = await transaction.hospitalityAvailabilityHold.findMany({
      where: { organizationId: input.organizationId, status: 'ACTIVE', expiresAt: { lte: now } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    });
    if (expired.length === 0) return 0;
    await transaction.hospitalityAvailabilityHold.updateMany({
      where: { organizationId: input.organizationId, id: { in: expired.map((hold) => hold.id) }, status: 'ACTIVE' },
      data: { status: 'EXPIRED', endedAt: now },
    });
    await transaction.auditEvent.createMany({
      data: expired.map((hold) => ({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'availability.hold.expired',
        resourceType: 'hospitality-availability-hold',
        resourceId: hold.id,
        beforeData: { status: 'ACTIVE' },
        afterData: { status: 'EXPIRED', endedAt: now.toISOString() },
      })),
    });
    return expired.length;
  }, { isolationLevel: 'Serializable' });
}
