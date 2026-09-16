import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  buildRentalPricingEvidence,
  RentalAvailabilityIntegrityError,
} from './rental-availability-domain.ts';
import { findOverdueRentalCustodyUnitIds } from './rental-custody-availability.ts';
import {
  normalizeRentalAvailabilityHoldInput,
  rentalAvailabilityHoldPayloadMatches,
  type RentalAvailabilityHoldInput,
} from './rental-hold-domain.ts';
import { RentalInventoryValidationError } from './rental-domain.ts';
import { rentalUnitLockKey } from './rental-lock-domain.ts';
import {
  RentalInventoryConflictError,
  RentalInventoryUnavailableError,
} from './rental-service.ts';

function idempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `sf:rental-hold:${organizationId}:idempotency:${idempotencyKey}`;
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

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function hasCompletePricingEvidence(hold: Readonly<{
  quotedCurrency: string | null;
  quotedTotalMinor: bigint | null;
  pricingFingerprint: string | null;
  pricingSnapshot: Prisma.JsonValue | null;
  pricingObservedAt: Date | null;
}>) {
  const fields = [
    hold.quotedCurrency,
    hold.quotedTotalMinor,
    hold.pricingFingerprint,
    hold.pricingSnapshot,
    hold.pricingObservedAt,
  ];
  const present = fields.filter((value) => value !== null).length;
  if (present !== 0 && present !== fields.length) {
    throw new RentalAvailabilityIntegrityError('Rental hold pricing evidence is incomplete.');
  }
  return present === fields.length;
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
          'That rental hold idempotency key was already used for a different unit, date range, or duration.',
        );
      }
      return existing;
    }

    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalUnitLockKey(input.organizationId, hold.unitId)}, 0))`;

    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError('Database time authority is unavailable for rental hold creation.');
    }

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
        locationId: true,
        unitType: {
          select: {
            id: true,
            code: true,
            currency: true,
            defaultDailyRateMinor: true,
          },
        },
      },
    });
    if (!unit || !unit.locationId) {
      throw new RentalInventoryUnavailableError(
        'Rental unit is not active at an active location in this organization.',
      );
    }

    const [blockOverlap, holdOverlap, bookingOverlap, overdueCustodyUnitIds, ratePeriods] = await Promise.all([
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
      transaction.rentalBookingAllocation.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: unit.id,
          startsOn: { lt: hold.endsOn },
          endsOn: { gt: hold.startsOn },
          booking: {
            is: {
              organizationId: input.organizationId,
              status: { not: 'CANCELLED' },
            },
          },
        },
        select: { id: true },
      }),
      findOverdueRentalCustodyUnitIds(transaction, {
        organizationId: input.organizationId,
        observedAt: databaseClock.now,
        unitId: unit.id,
      }),
      transaction.rentalRatePeriod.findMany({
        where: {
          organizationId: input.organizationId,
          unitTypeId: unit.unitType.id,
          startsOn: { lt: hold.endsOn },
          endsOn: { gt: hold.startsOn },
        },
        orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
        select: { startsOn: true, endsOn: true, dailyRateMinor: true },
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
    if (bookingOverlap) {
      throw new RentalInventoryConflictError(
        'That rental unit is already booked for part of the requested date range.',
      );
    }
    if (overdueCustodyUnitIds.length > 0) {
      throw new RentalInventoryConflictError(
        'That rental unit is overdue from an earlier pickup and has not been returned yet.',
      );
    }

    const pricingEvidence = buildRentalPricingEvidence({
      unitTypeId: unit.unitType.id,
      currency: unit.unitType.currency,
      startsOn: hold.startsOn,
      endsOn: hold.endsOn,
      defaultDailyRateMinor: unit.unitType.defaultDailyRateMinor,
      ratePeriods,
    });
    const created = await transaction.rentalAvailabilityHold.create({
      data: {
        organizationId: input.organizationId,
        unitId: unit.id,
        startsOn: hold.startsOn,
        endsOn: hold.endsOn,
        idempotencyKey: hold.idempotencyKey,
        expiresAt,
        quotedCurrency: pricingEvidence.currency,
        quotedTotalMinor: BigInt(pricingEvidence.totalMinor),
        pricingFingerprint: pricingEvidence.fingerprint,
        pricingSnapshot: toJsonInput(pricingEvidence.snapshot),
        pricingObservedAt: now,
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
          unitTypeCode: unit.unitType.code,
          startsOn: created.startsOn.toISOString(),
          endsOn: created.endsOn.toISOString(),
          expiresAt: created.expiresAt.toISOString(),
          quotedCurrency: pricingEvidence.currency,
          quotedTotalMinor: pricingEvidence.totalMinor,
          pricingFingerprint: pricingEvidence.fingerprint,
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

export async function readRentalAvailabilityHoldPricingReview(input: Readonly<{
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
    permission: 'availability:read',
  });
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'pricing:read',
  });
  const now = input.now ?? new Date();
  assertValidNow(now);

  return db.$transaction(async (transaction) => {
    const hold = await transaction.rentalAvailabilityHold.findFirst({
      where: {
        id: input.holdId,
        organizationId: input.organizationId,
      },
      include: {
        unit: {
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            unitType: {
              select: {
                id: true,
                code: true,
                name: true,
                status: true,
                currency: true,
                defaultDailyRateMinor: true,
              },
            },
            location: {
              select: {
                id: true,
                code: true,
                name: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!hold) {
      throw new RentalInventoryUnavailableError(
        'Rental availability hold is not available in this organization.',
      );
    }

    const ratePeriods = await transaction.rentalRatePeriod.findMany({
      where: {
        organizationId: input.organizationId,
        unitTypeId: hold.unit.unitType.id,
        startsOn: { lt: hold.endsOn },
        endsOn: { gt: hold.startsOn },
      },
      orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
      select: { startsOn: true, endsOn: true, dailyRateMinor: true },
    });
    const current = buildRentalPricingEvidence({
      unitTypeId: hold.unit.unitType.id,
      currency: hold.unit.unitType.currency,
      startsOn: hold.startsOn,
      endsOn: hold.endsOn,
      defaultDailyRateMinor: hold.unit.unitType.defaultDailyRateMinor,
      ratePeriods,
    });
    const complete = hasCompletePricingEvidence(hold);
    const pricingState = !complete
      ? 'LEGACY' as const
      : hold.pricingFingerprint === current.fingerprint
        ? 'CURRENT' as const
        : 'CHANGED' as const;

    return Object.freeze({
      hold,
      effective: hold.status === 'ACTIVE' && hold.expiresAt > now,
      pricingState,
      original: complete
        ? Object.freeze({
            currency: hold.quotedCurrency as string,
            totalMinor: hold.quotedTotalMinor as bigint,
            fingerprint: hold.pricingFingerprint as string,
            observedAt: hold.pricingObservedAt as Date,
            snapshot: hold.pricingSnapshot,
          })
        : null,
      current: Object.freeze({
        currency: current.currency,
        totalMinor: BigInt(current.totalMinor),
        fingerprint: current.fingerprint,
        quote: current.quote,
      }),
    });
  }, { isolationLevel: 'Serializable' });
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
