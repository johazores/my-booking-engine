import type { Prisma } from '../../generated/prisma/client.ts';
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

export async function createHospitalityAvailabilityHoldInTransaction(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  hold: AvailabilityHoldInput;
  now: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const normalized = normalizeAvailabilityHoldInput(input.hold);
  const request = normalized.request;
  assertUuidIdentifier(request.propertyId, 'propertyId');
  assertUuidIdentifier(request.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(request.ratePlanId, 'ratePlanId');

  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityAvailabilityAllocationLockKey({ organizationId: input.organizationId, propertyId: request.propertyId, roomTypeId: request.roomTypeId })}, 0))`;

  const existing = await input.transaction.hospitalityAvailabilityHold.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: normalized.idempotencyKey } },
  });
  if (existing) {
    if (!availabilityHoldPayloadMatches({ hold: existing, request })) {
      throw new AvailabilityHoldConflictError('Idempotency key was already used for a different availability hold request.');
    }
    return { hold: existing, created: false as const };
  }

  const assignment = await input.transaction.hospitalityRoomTypeRatePlan.findFirst({
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

  const [physicalCapacity, restrictions, windows, activeHolds, allocations] = await Promise.all([
    input.transaction.hospitalityRoom.count({ where: { organizationId: input.organizationId, propertyId: request.propertyId, roomTypeId: request.roomTypeId, status: 'ACTIVE' } }),
    input.transaction.hospitalityRestriction.findMany({
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
    input.transaction.hospitalityAvailabilityWindow.findMany({
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
    input.transaction.hospitalityAvailabilityHold.findMany({
      where: {
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        roomTypeId: request.roomTypeId,
        status: 'ACTIVE',
        expiresAt: { gt: input.now },
        arrivalDate: { lt: request.departureDate },
        departureDate: { gt: request.arrivalDate },
      },
      select: { arrivalDate: true, departureDate: true, quantity: true },
    }),
    input.transaction.hospitalityBookingAllocation.findMany({
      where: {
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        roomTypeId: request.roomTypeId,
        arrivalDate: { lt: request.departureDate },
        departureDate: { gt: request.arrivalDate },
        booking: { is: { status: { not: 'CANCELLED' } } },
      },
      select: { arrivalDate: true, departureDate: true, quantity: true },
    }),
  ]);

  const restrictionResult = evaluateAvailabilityRestrictions({ arrivalDate: request.arrivalDate, departureDate: request.departureDate, stayNights: request.stayNights, restrictions });
  if (!restrictionResult.allowed) {
    throw new AvailabilityHoldUnavailableError(`Requested stay is restricted: ${restrictionResult.reasons.join(', ')}.`);
  }
  const capacity = calculateAvailabilityHoldCapacity({ physicalCapacity, arrivalDate: request.arrivalDate, departureDate: request.departureDate, windows, holds: activeHolds, allocations });
  if (capacity.sellableUnits < request.quantity) {
    throw new AvailabilityHoldUnavailableError('Requested units are no longer available for the full stay.');
  }

  const expiresAt = new Date(input.now.getTime() + normalized.expiresInMinutes * 60_000);
  const created = await input.transaction.hospitalityAvailabilityHold.create({
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

  return { hold: created, created: true as const };
}

export async function releaseHospitalityAvailabilityHoldInTransaction(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  holdId: string;
  now: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.holdId, 'holdId');

  let current = await input.transaction.hospitalityAvailabilityHold.findFirst({
    where: { id: input.holdId, organizationId: input.organizationId },
  });
  if (!current) throw new AvailabilityHoldUnavailableError();

  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityAvailabilityAllocationLockKey({ organizationId: input.organizationId, propertyId: current.propertyId, roomTypeId: current.roomTypeId })}, 0))`;
  current = await input.transaction.hospitalityAvailabilityHold.findFirst({
    where: { id: input.holdId, organizationId: input.organizationId },
  });
  if (!current) throw new AvailabilityHoldUnavailableError();
  if (current.status !== 'ACTIVE') return { hold: current, changed: false as const };

  const status = current.expiresAt <= input.now ? 'EXPIRED' as const : 'RELEASED' as const;
  const updated = await input.transaction.hospitalityAvailabilityHold.update({
    where: { id: current.id },
    data: { status, endedAt: input.now },
  });
  return { hold: updated, changed: true as const, previousStatus: current.status };
}
