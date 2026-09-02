import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import type { AvailabilityHoldInput } from './availability-hold-domain.ts';
import {
  AvailabilityHoldConflictError,
  AvailabilityHoldUnavailableError,
  createHospitalityAvailabilityHoldInTransaction,
  releaseHospitalityAvailabilityHoldInTransaction,
} from './hospitality-availability-hold-core.ts';

export { AvailabilityHoldConflictError, AvailabilityHoldUnavailableError } from './hospitality-availability-hold-core.ts';

export async function createHospitalityAvailabilityHold(input: {
  organizationId: string;
  actorUserId: string;
  hold: AvailabilityHoldInput;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:manage' });
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    const result = await createHospitalityAvailabilityHoldInTransaction({
      transaction,
      organizationId: input.organizationId,
      hold: input.hold,
      now,
    });
    if (!result.created) return result.hold;

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'availability.hold.created',
        resourceType: 'hospitality-availability-hold',
        resourceId: result.hold.id,
        afterData: {
          propertyId: result.hold.propertyId,
          roomTypeId: result.hold.roomTypeId,
          ratePlanId: result.hold.ratePlanId,
          quantity: result.hold.quantity,
          expiresAt: result.hold.expiresAt.toISOString(),
        },
      },
    });
    return result.hold;
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
    const result = await releaseHospitalityAvailabilityHoldInTransaction({
      transaction,
      organizationId: input.organizationId,
      holdId: input.holdId,
      now,
    });
    if (!result.changed) return result.hold;

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: result.hold.status === 'EXPIRED' ? 'availability.hold.expired' : 'availability.hold.released',
        resourceType: 'hospitality-availability-hold',
        resourceId: result.hold.id,
        beforeData: { status: result.previousStatus },
        afterData: { status: result.hold.status, endedAt: now.toISOString() },
      },
    });
    return result.hold;
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
