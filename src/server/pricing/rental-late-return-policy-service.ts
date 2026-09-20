import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import {
  RentalInventoryConflictError,
  RentalInventoryUnavailableError,
} from '../inventory/rental-service.ts';
import { rentalUnitTypeLifecycleLockKey } from '../inventory/rental-lock-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { classifyRentalBookingWriteError } from '../bookings/rental-booking-write-errors.ts';
import {
  normalizeRentalLateReturnPolicyInput,
  rentalLateReturnPolicyMatches,
  type RentalLateReturnPolicyInput,
} from './rental-late-return-policy-domain.ts';

function rentalLateReturnPolicyLockKey(organizationId: string, unitTypeId: string) {
  return `sf:rental-late-return-policy:${organizationId}:unit-type:${unitTypeId}`;
}

async function runPolicyWrite<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE' || disposition === 'CONFLICT') {
        throw new RentalInventoryConflictError('Late-return policy changed concurrently. Refresh the unit type and try again.');
      }
      throw error;
    }
  }
  throw new RentalInventoryConflictError('Late-return policy could not be serialized.');
}

async function requirePolicyReadPermissions(input: Readonly<{ organizationId: string; actorUserId: string }>) {
  await Promise.all([
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'inventory:read',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'pricing:read',
    }),
  ]);
}

async function requirePolicyWritePermissions(input: Readonly<{ organizationId: string; actorUserId: string }>) {
  await Promise.all([
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'inventory:read',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'pricing:manage',
    }),
  ]);
}

export async function readRentalLateReturnPolicy(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  unitTypeId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.unitTypeId, 'unitTypeId');
  await requirePolicyReadPermissions(input);

  const unitType = await db.rentalUnitType.findFirst({
    where: { id: input.unitTypeId, organizationId: input.organizationId },
    select: { id: true, code: true, name: true, currency: true, status: true },
  });
  if (!unitType) {
    throw new RentalInventoryUnavailableError('Rental unit type is not available for late-return policy in this organization.');
  }
  const revision = await db.rentalLateReturnPolicyRevision.findFirst({
    where: { organizationId: input.organizationId, unitTypeId: unitType.id },
    orderBy: [{ version: 'desc' }, { effectiveAt: 'desc' }, { id: 'desc' }],
  });

  return Object.freeze({ unitType, revision });
}

export async function reviseRentalLateReturnPolicy(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  unitTypeId: string;
  policy: RentalLateReturnPolicyInput;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.unitTypeId, 'unitTypeId');
  await requirePolicyWritePermissions(input);

  return runPolicyWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitTypeLifecycleLockKey(input.organizationId, input.unitTypeId)}, 0)
      )
    `;
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalLateReturnPolicyLockKey(input.organizationId, input.unitTypeId)}, 0)
      )
    `;

    const unitType = await transaction.rentalUnitType.findFirst({
      where: {
        id: input.unitTypeId,
        organizationId: input.organizationId,
      },
      select: { id: true, currency: true, status: true },
    });
    if (!unitType) {
      throw new RentalInventoryUnavailableError('Rental unit type is not available for late-return policy in this organization.');
    }

    const requested = normalizeRentalLateReturnPolicyInput(input.policy, unitType.currency);
    const replayVersion = requested.expectedVersion + 1;
    const [latest, replayRevision] = await Promise.all([
      transaction.rentalLateReturnPolicyRevision.findFirst({
        where: { organizationId: input.organizationId, unitTypeId: unitType.id },
        orderBy: [{ version: 'desc' }, { effectiveAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.rentalLateReturnPolicyRevision.findFirst({
        where: {
          organizationId: input.organizationId,
          unitTypeId: unitType.id,
          version: replayVersion,
        },
      }),
    ]);
    const currentVersion = latest?.version ?? 0;

    if (
      replayRevision
      && replayRevision.version === replayVersion
      && rentalLateReturnPolicyMatches(replayRevision, requested)
    ) {
      return Object.freeze({ revision: replayRevision, idempotent: true as const });
    }

    if (unitType.status !== 'ACTIVE') {
      throw new RentalInventoryUnavailableError('Active rental unit type is not available for late-return policy in this organization.');
    }

    if (currentVersion === requested.expectedVersion && latest && rentalLateReturnPolicyMatches(latest, requested)) {
      return Object.freeze({ revision: latest, idempotent: true as const });
    }
    if (currentVersion !== requested.expectedVersion) {
      throw new RentalInventoryConflictError('Late-return policy changed since this page was loaded. Refresh before saving.');
    }

    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalInventoryConflictError('Database time authority is unavailable for late-return policy.');
    }

    const revision = await transaction.rentalLateReturnPolicyRevision.create({
      data: {
        organizationId: input.organizationId,
        unitTypeId: unitType.id,
        version: currentVersion + 1,
        enabled: requested.enabled,
        graceDays: requested.graceDays,
        dailyFeeMinor: requested.dailyFeeMinor,
        currency: requested.currency,
        reason: requested.reason,
        effectiveAt: databaseClock.now,
        createdByUserId: input.actorUserId,
        createdAt: databaseClock.now,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: requested.enabled
          ? 'pricing.rental.late-return-policy.enabled'
          : 'pricing.rental.late-return-policy.disabled',
        resourceType: 'rental-late-return-policy-revision',
        resourceId: revision.id,
        afterData: {
          unitTypeId: revision.unitTypeId,
          version: revision.version,
          enabled: revision.enabled,
          graceDays: revision.graceDays,
          dailyFeeMinor: revision.dailyFeeMinor?.toString() ?? null,
          currency: revision.currency,
          effectiveAt: revision.effectiveAt.toISOString(),
          reason: revision.reason,
        },
      },
    });

    return Object.freeze({ revision, idempotent: false as const });
  }, { isolationLevel: 'Serializable' }));
}
