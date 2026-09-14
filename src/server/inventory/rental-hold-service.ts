import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  normalizeRentalAvailabilityHoldInput,
  rentalAvailabilityHoldPayloadMatches,
  type RentalAvailabilityHoldInput,
} from './rental-hold-domain.ts';
import {
  normalizeRentalDateRange,
  RentalInventoryValidationError,
} from './rental-domain.ts';
import {
  RentalInventoryConflictError,
  RentalInventoryUnavailableError,
} from './rental-service.ts';

function idempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `sf:rental-hold:${organizationId}:idempotency:${idempotencyKey}`;
}

function rentalUnitLockKey(organizationId: string, unitId: string) {
  return `sf:rental-unit:${organizationId}:${unitId}`;
}

function normalizePage(value: number, field: string, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RentalInventoryValidationError(`${field} is invalid.`);
  }
  return value;
}

function assertValidNow(now: Date) {
  if (!Number.isFinite(now.getTime())) {
    throw new RentalInventoryValidationError('Hold time is invalid.');
  }
}

export async function createRentalAvailabilityHold(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  hold: RentalAvailabilityHoldInput;
  now?: Date;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'availability:manage',
  });

  const hold = normalizeRentalAvailabilityHoldInput(input.hold);
  assertUuidIdentifier(hold.unitId, 'unitId');
  const now = input.now ?? new Date();
  assertValidNow(now);
  const expiresAt = new Date(now.getTime() + hold.expiresInMinutes * 60_000);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockKey(input.organizationId, hold.idempotencyKey)}, 0))`;

    const existing = await transaction.rentalAvailabilityHold.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: hold.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (!rentalAvailabilityHoldPayloadMatches({ hold: existing, requested: hold })) {
        throw new RentalInventoryConflictError(
          'That rental hold idempotency key was already used for a different unit or date range.',
        );
      }
      return existing;
    }

    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalUnitLockKey(input.organizationId, hold.unitId)}, 0))`;

    const unit = await transaction.rentalUnit.findFirst({
      where: {
        id: hold.unitId,
        organizationId: input.organizationId,
        status: 'ACTIVE',
        unitType: {
          organizationId: input.organizationId,
          status: 'ACTIVE',
        },
        location: {
          is: {
            organizationId: input.organizationId,
            status: 'ACTIVE',
          },
        },
      },
      select: {
        id: true,
        code: true,
        unitTypeId: true,
        locationId: true,
      },
    });
    if (!unit || !unit.locationId) {
      throw new RentalInventoryUnavailableError(
        'Rental unit is not active at an active location in this organization.',
      );
    }

    const [blockOverlap, holdOverlap] = await Promise.all([
      transaction.rentalAvailabilityBlock.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: unit.id,
          startsOn: { lt: hold.endsOn },
          endsOn: { gt: hold.startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: unit.id,
          status: 'ACTIVE',
          expiresAt: { gt: now },
          startsOn: { lt: hold.endsOn },
          endsOn: { gt: hold.startsOn },
        },
        select: { id: true },
      }),
    ]);
    if (blockOverlap) {
      throw new RentalInventoryConflictError(
        'That rental unit has an availability block overlapping the requested hold dates.',
      );
    }
    if (holdOverlap) {
      throw new RentalInventoryConflictError(
        'That rental unit is already held for part of the requested date range.',
      );
    }

    const created = await transaction.rentalAvailabilityHold.create({
      data: {
        organizationId: input.organizationId,
        unitId: unit.id,
        startsOn: hold.startsOn,
        endsOn: hold.endsOn,
        idempotencyKey: hold.idempotencyKey,
        expiresAt,
        createdAt: now,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'availability.rental-hold.created',
        resourceType: 'rental-availability-hold',
        resourceId: created.id,
        afterData: {
          unitId: unit.id,
          unitCode: unit.code,
          startsOn: created.startsOn.toISOString(),
          endsOn: created.endsOn.toISOString(),
          expiresAt: created.expiresAt.toISOString(),
        },
      },
    });
    return created;
  }, { isolationLevel: 'ReadCommitted' });
}

export async function listRentalAvailabilityHolds(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  page: number;
  pageSize: number;
  now?: Date;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'availability:read',
  });
  const page = normalizePage(input.page, 'Page', 10_000);
  const pageSize = normalizePage(input.pageSize, 'Page size', 100);
  const now = input.now ?? new Date();
  assertValidNow(now);

  const where = {
    organizationId: input.organizationId,
    status: 'ACTIVE' as const,
    expiresAt: { gt: now },
  };
  const [total, items] = await db.$transaction([
    db.rentalAvailabilityHold.count({ where }),
    db.rentalAvailabilityHold.findMany({
      where,
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        unit: {
          select: {
            id: true,
            code: true,
            name: true,
            unitType: { select: { code: true, name: true } },
            location: { select: { code: true, name: true } },
          },
        },
      },
    }),
  ]);

  return Object.freeze({
    items: Object.freeze(items),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

export async function releaseRentalAvailabilityHold(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  holdId: string;
  now?: Date;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.holdId, 'holdId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'availability:manage',
  });
  const now = input.now ?? new Date();
  assertValidNow(now);

  return db.$transaction(async (transaction) => {
    const current = await transaction.rentalAvailabilityHold.findFirst({
      where: {
        id: input.holdId,
        organizationId: input.organizationId,
      },
    });
    if (!current) {
      throw new RentalInventoryUnavailableError(
        'Rental availability hold is not available in this organization.',
      );
    }
    if (current.status !== 'ACTIVE') return current;

    const status = current.expiresAt <= now ? 'EXPIRED' as const : 'RELEASED' as const;
    const changed = await transaction.rentalAvailabilityHold.updateMany({
      where: {
        id: current.id,
        organizationId: input.organizationId,
        status: 'ACTIVE',
      },
      data: {
        status,
        endedAt: now,
      },
    });
    if (changed.count === 0) {
      return transaction.rentalAvailabilityHold.findFirstOrThrow({
        where: {
          id: current.id,
          organizationId: input.organizationId,
        },
      });
    }

    const updated = await transaction.rentalAvailabilityHold.findFirstOrThrow({
      where: {
        id: current.id,
        organizationId: input.organizationId,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: status === 'EXPIRED'
          ? 'availability.rental-hold.expired'
          : 'availability.rental-hold.released',
        resourceType: 'rental-availability-hold',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: {
          status,
          endedAt: now.toISOString(),
        },
      },
    });
    return updated;
  }, { isolationLevel: 'ReadCommitted' });
}

export async function assertRentalAvailabilityBlockNotHeld(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  unitId: string;
  startsOn: string;
  endsOn: string;
  now?: Date;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.unitId, 'unitId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'inventory:manage',
  });
  const range = normalizeRentalDateRange(input);
  const now = input.now ?? new Date();
  assertValidNow(now);

  const overlappingHold = await db.rentalAvailabilityHold.findFirst({
    where: {
      organizationId: input.organizationId,
      unitId: input.unitId,
      status: 'ACTIVE',
      expiresAt: { gt: now },
      startsOn: { lt: range.endsOn },
      endsOn: { gt: range.startsOn },
    },
    select: { id: true },
  });
  if (overlappingHold) {
    throw new RentalInventoryConflictError(
      'Release the overlapping rental availability hold before adding this unavailable-date block.',
    );
  }
}

export async function assertRentalUnitNotHeldForInventoryMutation(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  unitId: string;
  now?: Date;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.unitId, 'unitId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'inventory:manage',
  });
  const now = input.now ?? new Date();
  assertValidNow(now);

  const activeHold = await db.rentalAvailabilityHold.findFirst({
    where: {
      organizationId: input.organizationId,
      unitId: input.unitId,
      status: 'ACTIVE',
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  if (activeHold) {
    throw new RentalInventoryConflictError(
      'Release active rental availability holds before relocating or archiving this unit.',
    );
  }
}
