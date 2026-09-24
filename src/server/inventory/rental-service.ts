import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { resolveInventoryPagination } from './inventory-pagination.ts';
import { RentalAvailabilityIntegrityError } from './rental-availability-domain.ts';
import { findOverdueRentalCustodyUnitIds } from './rental-custody-availability.ts';
import {
  assertRentalArchiveConfirmation,
  assertRentalRemoveConfirmation,
  normalizeRentalAvailabilityBlockInput,
  normalizeRentalCode,
  normalizeRentalLocationInput,
  normalizeRentalRatePeriodInput,
  normalizeRentalUnitInput,
  normalizeRentalUnitTypeInput,
  type RentalAvailabilityBlockInput,
  type RentalLocationInput,
  type RentalRatePeriodInput,
  type RentalUnitInput,
  type RentalUnitTypeInput,
} from './rental-domain.ts';
import {
  rentalLocationLifecycleLockKey,
  rentalUnitLockKey,
  rentalUnitTypeLifecycleLockKey,
} from './rental-lock-domain.ts';
import { readRentalUnitArchiveOperationalReadiness } from './rental-unit-archive-readiness.ts';

export class RentalInventoryConflictError extends Error {
  constructor(message = 'A rental inventory record conflicts with an existing record.') {
    super(message);
    this.name = 'RentalInventoryConflictError';
  }
}

export class RentalInventoryUnavailableError extends Error {
  constructor(message = 'Rental inventory is not available in this organization.') {
    super(message);
    this.name = 'RentalInventoryUnavailableError';
  }
}

export class RentalInventoryDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalInventoryDependencyError';
  }
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

async function requireRentalPermission(input: { organizationId: string; actorUserId: string }, permission: 'inventory:read' | 'inventory:manage') {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission,
  });
}

async function lockRentalUnit(transaction: Prisma.TransactionClient, organizationId: string, unitId: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalUnitLockKey(organizationId, unitId)}, 0))`;
}

async function lockRentalLocationLifecycle(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  locationId: string,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${rentalLocationLifecycleLockKey(organizationId, locationId)}, 0)
    )
  `;
}

async function lockRentalUnitTypeLifecycle(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  unitTypeId: string,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${rentalUnitTypeLifecycleLockKey(organizationId, unitTypeId)}, 0)
    )
  `;
}

async function readRentalInventoryDatabaseClock(transaction: Prisma.TransactionClient, context: string) {
  const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS "now"
  `;
  if (!databaseClock?.now || !Number.isFinite(databaseClock.now.getTime())) {
    throw new RentalAvailabilityIntegrityError(`Database time authority is unavailable for ${context}.`);
  }
  return databaseClock.now;
}

async function assertRentalUnitMutationAuthority(input: Readonly<{
  transaction: Prisma.TransactionClient;
  organizationId: string;
  unitId: string;
  observedAt: Date;
  action: 'relocating' | 'archiving';
}>) {
  const [activeHold, activeOrFutureBookings, overdueCustodyUnitIds] = await Promise.all([
    input.transaction.rentalAvailabilityHold.findFirst({
      where: {
        organizationId: input.organizationId,
        unitId: input.unitId,
        status: 'ACTIVE',
        expiresAt: { gt: input.observedAt },
      },
      select: { id: true },
    }),
    input.transaction.$queryRaw<Array<{ bookingId: string }>>`
      SELECT allocation."bookingId" AS "bookingId"
        FROM "rental_booking_allocations" allocation
        JOIN "rental_bookings" booking
          ON booking."id" = allocation."bookingId"
         AND booking."organizationId" = allocation."organizationId"
        JOIN "rental_locations" location
          ON location."id" = booking."locationId"
         AND location."organizationId" = booking."organizationId"
       WHERE allocation."organizationId" = ${input.organizationId}::uuid
         AND allocation."unitId" = ${input.unitId}::uuid
         AND booking."status" <> 'CANCELLED'
         AND allocation."endsOn" > (${input.observedAt}::timestamptz AT TIME ZONE location."timeZone")::date
       LIMIT 1
    `,
    findOverdueRentalCustodyUnitIds(input.transaction, {
      organizationId: input.organizationId,
      observedAt: input.observedAt,
      unitId: input.unitId,
    }),
  ]);

  if (activeHold) {
    throw new RentalInventoryConflictError(
      `Release active rental availability holds before ${input.action} this rental unit.`,
    );
  }
  if (activeOrFutureBookings.length > 0) {
    throw new RentalInventoryConflictError(
      `Resolve active or future rental bookings before ${input.action} this rental unit.`,
    );
  }
  if (overdueCustodyUnitIds.length > 0) {
    throw new RentalInventoryConflictError(
      `Record the outstanding rental return before ${input.action} this rental unit.`,
    );
  }
}

export async function listRentalInventory(input: {
  organizationId: string;
  actorUserId: string;
  unitTypePage: number;
  locationPage: number;
  unitPage: number;
  pageSize: number;
}) {
  await requireRentalPermission(input, 'inventory:read');
  return db.$transaction(async (transaction) => {
    const [unitTypeTotal, locationTotal, unitTotal] = await Promise.all([
      transaction.rentalUnitType.count({ where: { organizationId: input.organizationId, status: 'ACTIVE' } }),
      transaction.rentalLocation.count({ where: { organizationId: input.organizationId, status: 'ACTIVE' } }),
      transaction.rentalUnit.count({ where: { organizationId: input.organizationId, status: 'ACTIVE' } }),
    ]);
    const unitTypePagination = resolveInventoryPagination({ total: unitTypeTotal, page: input.unitTypePage, pageSize: input.pageSize });
    const locationPagination = resolveInventoryPagination({ total: locationTotal, page: input.locationPage, pageSize: input.pageSize });
    const unitPagination = resolveInventoryPagination({ total: unitTotal, page: input.unitPage, pageSize: input.pageSize });
    const [unitTypes, locations, units] = await Promise.all([
      transaction.rentalUnitType.findMany({
        where: { organizationId: input.organizationId, status: 'ACTIVE' },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: unitTypePagination.skip,
        take: unitTypePagination.take,
      }),
      transaction.rentalLocation.findMany({
        where: { organizationId: input.organizationId, status: 'ACTIVE' },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: locationPagination.skip,
        take: locationPagination.take,
      }),
      transaction.rentalUnit.findMany({
        where: { organizationId: input.organizationId, status: 'ACTIVE' },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        include: {
          unitType: { select: { name: true, code: true, currency: true } },
          location: { select: { name: true, code: true } },
        },
        skip: unitPagination.skip,
        take: unitPagination.take,
      }),
    ]);
    return {
      unitTypes: {
        items: unitTypes,
        total: unitTypeTotal,
        page: unitTypePagination.page,
        pageSize: unitTypePagination.pageSize,
        totalPages: unitTypePagination.totalPages,
      },
      locations: {
        items: locations,
        total: locationTotal,
        page: locationPagination.page,
        pageSize: locationPagination.pageSize,
        totalPages: locationPagination.totalPages,
      },
      units: {
        items: units,
        total: unitTotal,
        page: unitPagination.page,
        pageSize: unitPagination.pageSize,
        totalPages: unitPagination.totalPages,
      },
    };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function readRentalLocationInventory(input: {
  organizationId: string;
  actorUserId: string;
  locationId: string;
  unitPage: number;
  pageSize: number;
}) {
  await requireRentalPermission(input, 'inventory:read');
  assertUuidIdentifier(input.locationId, 'locationId');
  return db.$transaction(async (transaction) => {
    const location = await transaction.rentalLocation.findFirst({
      where: { id: input.locationId, organizationId: input.organizationId, status: 'ACTIVE' },
    });
    if (!location) throw new RentalInventoryUnavailableError('Rental location is not active in this organization.');
    const total = await transaction.rentalUnit.count({
      where: { organizationId: input.organizationId, locationId: location.id, status: 'ACTIVE' },
    });
    const pagination = resolveInventoryPagination({ total, page: input.unitPage, pageSize: input.pageSize });
    const units = await transaction.rentalUnit.findMany({
      where: { organizationId: input.organizationId, locationId: location.id, status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: { unitType: { select: { name: true, code: true } } },
      skip: pagination.skip,
      take: pagination.take,
    });
    return {
      location,
      units: {
        items: units,
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalPages: pagination.totalPages,
      },
    };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function readRentalUnitTypeInventory(input: {
  organizationId: string;
  actorUserId: string;
  unitTypeId: string;
  unitPage: number;
  ratePage: number;
  pageSize: number;
}) {
  await requireRentalPermission(input, 'inventory:read');
  assertUuidIdentifier(input.unitTypeId, 'unitTypeId');
  return db.$transaction(async (transaction) => {
    const unitType = await transaction.rentalUnitType.findFirst({
      where: { id: input.unitTypeId, organizationId: input.organizationId, status: 'ACTIVE' },
    });
    if (!unitType) throw new RentalInventoryUnavailableError('Rental unit type is not active in this organization.');
    const [unitTotal, rateTotal] = await Promise.all([
      transaction.rentalUnit.count({ where: { organizationId: input.organizationId, unitTypeId: unitType.id, status: 'ACTIVE' } }),
      transaction.rentalRatePeriod.count({ where: { organizationId: input.organizationId, unitTypeId: unitType.id } }),
    ]);
    const unitPagination = resolveInventoryPagination({ total: unitTotal, page: input.unitPage, pageSize: input.pageSize });
    const ratePagination = resolveInventoryPagination({ total: rateTotal, page: input.ratePage, pageSize: input.pageSize });
    const [units, rates] = await Promise.all([
      transaction.rentalUnit.findMany({
        where: { organizationId: input.organizationId, unitTypeId: unitType.id, status: 'ACTIVE' },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        include: { location: { select: { name: true, code: true } } },
        skip: unitPagination.skip,
        take: unitPagination.take,
      }),
      transaction.rentalRatePeriod.findMany({
        where: { organizationId: input.organizationId, unitTypeId: unitType.id },
        orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
        skip: ratePagination.skip,
        take: ratePagination.take,
      }),
    ]);
    return {
      unitType,
      units: {
        items: units,
        total: unitTotal,
        page: unitPagination.page,
        pageSize: unitPagination.pageSize,
        totalPages: unitPagination.totalPages,
      },
      rates: {
        items: rates,
        total: rateTotal,
        page: ratePagination.page,
        pageSize: ratePagination.pageSize,
        totalPages: ratePagination.totalPages,
      },
    };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function readRentalUnitInventory(input: {
  organizationId: string;
  actorUserId: string;
  unitId: string;
  blockPage: number;
  pageSize: number;
}) {
  await requireRentalPermission(input, 'inventory:read');
  assertUuidIdentifier(input.unitId, 'unitId');
  return db.$transaction(async (transaction) => {
    const unit = await transaction.rentalUnit.findFirst({
      where: { id: input.unitId, organizationId: input.organizationId, status: 'ACTIVE' },
      include: { unitType: true, location: true },
    });
    if (!unit) throw new RentalInventoryUnavailableError('Rental unit is not active in this organization.');
    const total = await transaction.rentalAvailabilityBlock.count({ where: { organizationId: input.organizationId, unitId: unit.id } });
    const pagination = resolveInventoryPagination({ total, page: input.blockPage, pageSize: input.pageSize });
    const blocks = await transaction.rentalAvailabilityBlock.findMany({
      where: { organizationId: input.organizationId, unitId: unit.id },
      orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
    });
    return {
      unit,
      blocks: {
        items: blocks,
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalPages: pagination.totalPages,
      },
    };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function createRentalLocation(input: {
  organizationId: string;
  actorUserId: string;
  location: RentalLocationInput;
}) {
  await requireRentalPermission(input, 'inventory:manage');
  const location = normalizeRentalLocationInput(input.location);
  try {
    return await db.$transaction(async (transaction) => {
      const created = await transaction.rentalLocation.create({ data: { organizationId: input.organizationId, ...location } });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.rental-location.created',
          resourceType: 'rental-location',
          resourceId: created.id,
          afterData: { code: created.code, countryCode: created.countryCode, timeZone: created.timeZone, status: created.status },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new RentalInventoryConflictError('A rental location with that code already exists in this organization.');
    throw error;
  }
}

export async function createRentalUnitType(input: {
  organizationId: string;
  actorUserId: string;
  unitType: RentalUnitTypeInput;
}) {
  await requireRentalPermission(input, 'inventory:manage');
  const unitType = normalizeRentalUnitTypeInput(input.unitType);
  try {
    return await db.$transaction(async (transaction) => {
      const created = await transaction.rentalUnitType.create({ data: { organizationId: input.organizationId, ...unitType } });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.rental-unit-type.created',
          resourceType: 'rental-unit-type',
          resourceId: created.id,
          afterData: { code: created.code, currency: created.currency, defaultDailyRateMinor: created.defaultDailyRateMinor, status: created.status },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new RentalInventoryConflictError('A rental unit type with that code already exists in this organization.');
    throw error;
  }
}

export async function createRentalUnit(input: {
  organizationId: string;
  actorUserId: string;
  unit: RentalUnitInput;
}) {
  await requireRentalPermission(input, 'inventory:manage');
  const unit = normalizeRentalUnitInput(input.unit);
  assertUuidIdentifier(unit.unitTypeId, 'unitTypeId');
  try {
    return await db.$transaction(async (transaction) => {
      const locationLocator = await transaction.rentalLocation.findFirst({
        where: { organizationId: input.organizationId, code: unit.locationCode, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!locationLocator) throw new RentalInventoryUnavailableError('Rental location is not active in this organization.');

      await lockRentalUnitTypeLifecycle(transaction, input.organizationId, unit.unitTypeId);
      await lockRentalLocationLifecycle(transaction, input.organizationId, locationLocator.id);

      const [unitType, location] = await Promise.all([
        transaction.rentalUnitType.findFirst({
          where: { id: unit.unitTypeId, organizationId: input.organizationId, status: 'ACTIVE' },
          select: { id: true, code: true },
        }),
        transaction.rentalLocation.findFirst({
          where: { id: locationLocator.id, organizationId: input.organizationId, status: 'ACTIVE' },
          select: { id: true, code: true },
        }),
      ]);
      if (!unitType) throw new RentalInventoryUnavailableError('Rental unit type is not active in this organization.');
      if (!location) throw new RentalInventoryUnavailableError('Rental location is not active in this organization.');
      const created = await transaction.rentalUnit.create({
        data: {
          organizationId: input.organizationId,
          unitTypeId: unit.unitTypeId,
          locationId: location.id,
          name: unit.name,
          code: unit.code,
          description: unit.description,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.rental-unit.created',
          resourceType: 'rental-unit',
          resourceId: created.id,
          afterData: { code: created.code, unitTypeId: created.unitTypeId, unitTypeCode: unitType.code, locationId: location.id, locationCode: location.code, status: created.status },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error instanceof RentalInventoryUnavailableError) throw error;
    if (isUniqueConstraintError(error)) throw new RentalInventoryConflictError('A rental unit with that code already exists in this organization.');
    throw error;
  }
}

export async function assignRentalUnitLocation(input: {
  organizationId: string;
  actorUserId: string;
  unitId: string;
  locationCode: string;
}) {
  await requireRentalPermission(input, 'inventory:manage');
  assertUuidIdentifier(input.unitId, 'unitId');
  const locationCode = normalizeRentalCode(input.locationCode);
  return db.$transaction(async (transaction) => {
    await lockRentalUnit(transaction, input.organizationId, input.unitId);
    const [unit, locationLocator] = await Promise.all([
      transaction.rentalUnit.findFirst({
        where: { id: input.unitId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true, locationId: true, unitTypeId: true, code: true },
      }),
      transaction.rentalLocation.findFirst({
        where: { organizationId: input.organizationId, code: locationCode, status: 'ACTIVE' },
        select: { id: true },
      }),
    ]);
    if (!unit) throw new RentalInventoryUnavailableError('Rental unit is not active in this organization.');
    if (!locationLocator) throw new RentalInventoryUnavailableError('Rental location is not active in this organization.');
    if (unit.locationId === locationLocator.id) return unit;

    await lockRentalUnitTypeLifecycle(transaction, input.organizationId, unit.unitTypeId);
    await lockRentalLocationLifecycle(transaction, input.organizationId, locationLocator.id);
    const location = await transaction.rentalLocation.findFirst({
      where: { id: locationLocator.id, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, code: true },
    });
    if (!location) throw new RentalInventoryUnavailableError('Rental location is not active in this organization.');

    const now = await readRentalInventoryDatabaseClock(transaction, 'rental unit relocation');
    await assertRentalUnitMutationAuthority({
      transaction,
      organizationId: input.organizationId,
      unitId: unit.id,
      observedAt: now,
      action: 'relocating',
    });

    const updated = await transaction.rentalUnit.update({
      where: { id: unit.id, organizationId: input.organizationId },
      data: { locationId: location.id },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rental-unit.location-assigned',
        resourceType: 'rental-unit',
        resourceId: unit.id,
        beforeData: { locationId: unit.locationId },
        afterData: { locationId: location.id, locationCode: location.code },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function createRentalAvailabilityBlock(input: {
  organizationId: string;
  actorUserId: string;
  block: RentalAvailabilityBlockInput;
}) {
  await requireRentalPermission(input, 'inventory:manage');
  const block = normalizeRentalAvailabilityBlockInput(input.block);
  assertUuidIdentifier(block.unitId, 'unitId');
  return db.$transaction(async (transaction) => {
    await lockRentalUnit(transaction, input.organizationId, block.unitId);
    const now = await readRentalInventoryDatabaseClock(transaction, 'rental availability-block creation');
    const [unit, overlap, overlappingHold, overlappingBooking] = await Promise.all([
      transaction.rentalUnit.findFirst({
        where: { id: block.unitId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true, code: true },
      }),
      transaction.rentalAvailabilityBlock.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: block.unitId,
          startsOn: { lt: block.endsOn },
          endsOn: { gt: block.startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: block.unitId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
          startsOn: { lt: block.endsOn },
          endsOn: { gt: block.startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: block.unitId,
          startsOn: { lt: block.endsOn },
          endsOn: { gt: block.startsOn },
          booking: {
            is: {
              organizationId: input.organizationId,
              status: { not: 'CANCELLED' },
            },
          },
        },
        select: { id: true },
      }),
    ]);
    if (!unit) throw new RentalInventoryUnavailableError('Rental unit is not active in this organization.');
    if (overlap) throw new RentalInventoryConflictError('That availability block overlaps an existing block for this rental unit.');
    if (overlappingHold) {
      throw new RentalInventoryConflictError(
        'Release the overlapping rental availability hold before adding this unavailable-date block.',
      );
    }
    if (overlappingBooking) {
      throw new RentalInventoryConflictError(
        'Resolve the overlapping rental booking before adding this unavailable-date block.',
      );
    }
    const created = await transaction.rentalAvailabilityBlock.create({ data: { organizationId: input.organizationId, ...block } });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rental-availability-block.created',
        resourceType: 'rental-availability-block',
        resourceId: created.id,
        afterData: { unitId: unit.id, unitCode: unit.code, startsOn: created.startsOn.toISOString(), endsOn: created.endsOn.toISOString() },
      },
    });
    return created;
  }, { isolationLevel: 'Serializable' });
}

export async function createRentalRatePeriod(input: {
  organizationId: string;
  actorUserId: string;
  rate: RentalRatePeriodInput;
}) {
  await requireRentalPermission(input, 'inventory:manage');
  const rate = normalizeRentalRatePeriodInput(input.rate);
  assertUuidIdentifier(rate.unitTypeId, 'unitTypeId');
  return db.$transaction(async (transaction) => {
    await lockRentalUnitTypeLifecycle(transaction, input.organizationId, rate.unitTypeId);
    const unitType = await transaction.rentalUnitType.findFirst({
      where: { id: rate.unitTypeId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, code: true },
    });
    if (!unitType) throw new RentalInventoryUnavailableError('Rental unit type is not active in this organization.');
    const overlap = await transaction.rentalRatePeriod.findFirst({
      where: {
        organizationId: input.organizationId,
        unitTypeId: unitType.id,
        startsOn: { lt: rate.endsOn },
        endsOn: { gt: rate.startsOn },
      },
      select: { id: true },
    });
    if (overlap) throw new RentalInventoryConflictError('That pricing period overlaps an existing pricing period for this unit type.');
    const created = await transaction.rentalRatePeriod.create({ data: { organizationId: input.organizationId, ...rate } });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rental-rate-period.created',
        resourceType: 'rental-rate-period',
        resourceId: created.id,
        afterData: { unitTypeId: unitType.id, unitTypeCode: unitType.code, startsOn: created.startsOn.toISOString(), endsOn: created.endsOn.toISOString(), dailyRateMinor: created.dailyRateMinor },
      },
    });
    return created;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveRentalLocation(input: {
  organizationId: string;
  actorUserId: string;
  locationId: string;
  confirmation: string;
}) {
  await requireRentalPermission(input, 'inventory:manage');
  assertUuidIdentifier(input.locationId, 'locationId');
  assertRentalArchiveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    await lockRentalLocationLifecycle(transaction, input.organizationId, input.locationId);
    const current = await transaction.rentalLocation.findFirst({
      where: { id: input.locationId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    if (!current) throw new RentalInventoryUnavailableError('Rental location is not active in this organization.');
    const activeUnits = await transaction.rentalUnit.count({
      where: { organizationId: input.organizationId, locationId: current.id, status: 'ACTIVE' },
    });
    if (activeUnits > 0) throw new RentalInventoryDependencyError('Move or archive active rental units before archiving this location.');
    const archivedAt = await readRentalInventoryDatabaseClock(transaction, 'rental location archival');
    const updated = await transaction.rentalLocation.update({
      where: { id: current.id, organizationId: input.organizationId },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rental-location.archived',
        resourceType: 'rental-location',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveRentalUnitType(input: {
  organizationId: string;
  actorUserId: string;
  unitTypeId: string;
  confirmation: string;
}) {
  await requireRentalPermission(input, 'inventory:manage');
  assertUuidIdentifier(input.unitTypeId, 'unitTypeId');
  assertRentalArchiveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    await lockRentalUnitTypeLifecycle(transaction, input.organizationId, input.unitTypeId);
    const current = await transaction.rentalUnitType.findFirst({
      where: { id: input.unitTypeId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    if (!current) throw new RentalInventoryUnavailableError('Rental unit type is not active in this organization.');
    const activeUnits = await transaction.rentalUnit.count({
      where: { organizationId: input.organizationId, unitTypeId: current.id, status: 'ACTIVE' },
    });
    if (activeUnits > 0) throw new RentalInventoryDependencyError('Archive active rental units before archiving this unit type.');
    const archivedAt = await readRentalInventoryDatabaseClock(transaction, 'rental unit-type archival');
    const updated = await transaction.rentalUnitType.update({
      where: { id: current.id, organizationId: input.organizationId },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rental-unit-type.archived',
        resourceType: 'rental-unit-type',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveRentalUnit(input: {
  organizationId: string;
  actorUserId: string;
  unitId: string;
  confirmation: string;
}) {
  await requireRentalPermission(input, 'inventory:manage');
  assertUuidIdentifier(input.unitId, 'unitId');
  assertRentalArchiveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    await lockRentalUnit(transaction, input.organizationId, input.unitId);
    const current = await transaction.rentalUnit.findFirst({
      where: { id: input.unitId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    if (!current) throw new RentalInventoryUnavailableError('Rental unit is not active in this organization.');

    const now = await readRentalInventoryDatabaseClock(transaction, 'rental unit archival');
    await assertRentalUnitMutationAuthority({
      transaction,
      organizationId: input.organizationId,
      unitId: current.id,
      observedAt: now,
      action: 'archiving',
    });

    const readiness = await readRentalUnitArchiveOperationalReadiness(transaction, {
      organizationId: input.organizationId,
      unitId: current.id,
    });
    if (!readiness) {
      throw new RentalInventoryConflictError('Rental unit archive readiness could not be verified.');
    }
    if (readiness.pendingReturnInspection) {
      throw new RentalInventoryConflictError(
        'Record the pending rental return inspection before archiving this rental unit.',
      );
    }
    if (readiness.activeMaintenance) {
      throw new RentalInventoryDependencyError(
        'Complete or cancel active rental maintenance before archiving this rental unit.',
      );
    }
    if (readiness.unresolvedNonClearInspection) {
      throw new RentalInventoryDependencyError(
        'Resolve non-clear rental return inspection evidence before archiving this rental unit.',
      );
    }
    if (readiness.unresolvedDamageCase) {
      throw new RentalInventoryDependencyError(
        'Waive or close the unresolved rental damage case before archiving this rental unit.',
      );
    }

    const archivedAt = now;
    const updated = await transaction.rentalUnit.update({
      where: { id: current.id, organizationId: input.organizationId },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rental-unit.archived',
        resourceType: 'rental-unit',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function removeRentalAvailabilityBlock(input: {
  organizationId: string;
  actorUserId: string;
  unitId: string;
  blockId: string;
  confirmation: string;
}) {
  await requireRentalPermission(input, 'inventory:manage');
  assertUuidIdentifier(input.unitId, 'unitId');
  assertUuidIdentifier(input.blockId, 'blockId');
  assertRentalRemoveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    const current = await transaction.rentalAvailabilityBlock.findFirst({
      where: { id: input.blockId, unitId: input.unitId, organizationId: input.organizationId },
    });
    if (!current) throw new RentalInventoryUnavailableError('Rental availability block is not available in this organization.');
    await transaction.rentalAvailabilityBlock.delete({
      where: { id: current.id, organizationId: input.organizationId },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rental-availability-block.removed',
        resourceType: 'rental-availability-block',
        resourceId: current.id,
        beforeData: { unitId: current.unitId, startsOn: current.startsOn.toISOString(), endsOn: current.endsOn.toISOString() },
      },
    });
  }, { isolationLevel: 'Serializable' });
}

export async function removeRentalRatePeriod(input: {
  organizationId: string;
  actorUserId: string;
  unitTypeId: string;
  rateId: string;
  confirmation: string;
}) {
  await requireRentalPermission(input, 'inventory:manage');
  assertUuidIdentifier(input.unitTypeId, 'unitTypeId');
  assertUuidIdentifier(input.rateId, 'rateId');
  assertRentalRemoveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    const current = await transaction.rentalRatePeriod.findFirst({
      where: { id: input.rateId, unitTypeId: input.unitTypeId, organizationId: input.organizationId },
    });
    if (!current) throw new RentalInventoryUnavailableError('Rental rate period is not available in this organization.');
    await transaction.rentalRatePeriod.delete({
      where: { id: current.id, organizationId: input.organizationId },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.rental-rate-period.removed',
        resourceType: 'rental-rate-period',
        resourceId: current.id,
        beforeData: { unitTypeId: current.unitTypeId, startsOn: current.startsOn.toISOString(), endsOn: current.endsOn.toISOString(), dailyRateMinor: current.dailyRateMinor },
      },
    });
  }, { isolationLevel: 'Serializable' });
}
