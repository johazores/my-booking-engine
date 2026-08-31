import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { hospitalityAvailabilityAllocationLockKey } from './availability-allocation-lock.ts';
import { AvailabilityUnavailableError } from './hospitality-availability-service.ts';
import { normalizeAvailabilityWindowInput, type AvailabilityWindowInput } from './availability-window-domain.ts';

export class AvailabilityWindowConflictError extends Error {
  constructor(message = 'An active availability window already overlaps this date range.') {
    super(message);
    this.name = 'AvailabilityWindowConflictError';
  }
}

const DAY_MS = 86_400_000;

function peakHeldUnitsForWindow(input: {
  startDate: Date;
  endDate: Date;
  holds: readonly { arrivalDate: Date; departureDate: Date; quantity: number }[];
}) {
  let peak = 0;
  for (let time = input.startDate.getTime(); time <= input.endDate.getTime(); time += DAY_MS) {
    const night = new Date(time);
    const held = input.holds.reduce((total, hold) => total + (hold.arrivalDate <= night && hold.departureDate > night ? hold.quantity : 0), 0);
    peak = Math.max(peak, held);
  }
  return peak;
}

export async function listHospitalityAvailabilityWindows(input: { organizationId: string; actorUserId: string; propertyId: string; roomTypeId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:read' });
  return db.hospitalityAvailabilityWindow.findMany({
    where: { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId },
    orderBy: [{ status: 'asc' }, { startDate: 'asc' }, { id: 'asc' }],
  });
}

export async function createHospitalityAvailabilityWindow(input: { organizationId: string; actorUserId: string; window: AvailabilityWindowInput; now?: Date }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:manage' });
  const window = normalizeAvailabilityWindowInput(input.window);
  assertUuidIdentifier(window.propertyId, 'propertyId');
  assertUuidIdentifier(window.roomTypeId, 'roomTypeId');
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityAvailabilityAllocationLockKey({ organizationId: input.organizationId, propertyId: window.propertyId, roomTypeId: window.roomTypeId })}, 0))`;
    const roomType = await transaction.hospitalityRoomType.findFirst({
      where: { id: window.roomTypeId, propertyId: window.propertyId, organizationId: input.organizationId, status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } },
      select: { id: true },
    });
    if (!roomType) throw new AvailabilityUnavailableError('Room type is not available in this organization.');
    const [overlap, activeHolds] = await Promise.all([
      transaction.hospitalityAvailabilityWindow.findFirst({
        where: {
          organizationId: input.organizationId,
          propertyId: window.propertyId,
          roomTypeId: window.roomTypeId,
          status: 'ACTIVE',
          startDate: { lte: window.endDate },
          endDate: { gte: window.startDate },
        },
        select: { id: true },
      }),
      transaction.hospitalityAvailabilityHold.findMany({
        where: {
          organizationId: input.organizationId,
          propertyId: window.propertyId,
          roomTypeId: window.roomTypeId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
          arrivalDate: { lte: window.endDate },
          departureDate: { gt: window.startDate },
        },
        select: { arrivalDate: true, departureDate: true, quantity: true },
      }),
    ]);
    if (overlap) throw new AvailabilityWindowConflictError();
    const heldUnits = peakHeldUnitsForWindow({ startDate: window.startDate, endDate: window.endDate, holds: activeHolds });
    if (window.capacityLimit < heldUnits) {
      throw new AvailabilityWindowConflictError('Capacity limit cannot be lower than units protected by active holds in this date range.');
    }
    const created = await transaction.hospitalityAvailabilityWindow.create({ data: { organizationId: input.organizationId, ...window } });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'availability.window.created',
        resourceType: 'hospitality-availability-window',
        resourceId: created.id,
        afterData: { propertyId: created.propertyId, roomTypeId: created.roomTypeId, startDate: created.startDate.toISOString().slice(0, 10), endDate: created.endDate.toISOString().slice(0, 10), capacityLimit: created.capacityLimit, status: created.status },
      },
    });
    return created;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveHospitalityAvailabilityWindow(input: { organizationId: string; actorUserId: string; windowId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.windowId, 'windowId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:manage' });
  return db.$transaction(async (transaction) => {
    const current = await transaction.hospitalityAvailabilityWindow.findFirst({ where: { id: input.windowId, organizationId: input.organizationId, status: 'ACTIVE' } });
    if (!current) throw new AvailabilityUnavailableError('Availability window is not available in this organization.');
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityAvailabilityAllocationLockKey({ organizationId: input.organizationId, propertyId: current.propertyId, roomTypeId: current.roomTypeId })}, 0))`;
    const archivedAt = new Date();
    const updated = await transaction.hospitalityAvailabilityWindow.update({ where: { id: current.id }, data: { status: 'ARCHIVED', archivedAt } });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'availability.window.archived', resourceType: 'hospitality-availability-window', resourceId: current.id, beforeData: { status: current.status }, afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() } } });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
