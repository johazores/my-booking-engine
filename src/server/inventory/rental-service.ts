import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { RentalAvailabilityIntegrityError } from './rental-availability-domain.ts';
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
import { rentalUnitLockKey } from './rental-lock-domain.ts';

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

async function readRentalInventoryDatabaseClock(transaction: Prisma.TransactionClient, context: string) {
  const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS "now"
  `;
  if (!databaseClock?.now || !Number.isFinite(databaseClock.now.getTime())) {
    throw new RentalAvailabilityIntegrityError(`Database time authority is unavailable for ${context}.`);
  }
  return databaseClock.now;
}

function pagination(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
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
  const [unitTypeTotal, unitTypes, locationTotal, locations, unitTotal, units] = await db.$transaction([
    db.rentalUnitType.count({ where: { organizationId: input.organizationId, status: 'ACTIVE' } }),
    db.rentalUnitType.findMany({
      where: { organizationId: input.organizationId, status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...pagination(input.unitTypePage, input.pageSize),
    }),
    db.rentalLocation.count({ where: { organizationId: input.organizationId, status: 'ACTIVE' } }),
    db.rentalLocation.findMany({
      where: { organizationId: input.organizationId, status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...pagination(input.locationPage, input.pageSize),
    }),
    db.rentalUnit.count({ where: { organizationId: input.organizationId, status: 'ACTIVE' } }),
    db.rentalUnit.findMany({
      where: { organizationId: input.organizationId, status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: {
        unitType: { select: { name: true, code: true, currency: true } },
        location: { select: { name: true, code: true } },
      },
      ...pagination(input.unitPage, input.pageSize),
    }),
  ]);
  return {
    unitTypes: { items: unitTypes, total: unitTypeTotal, page: input.unitTypePage, totalPages: Math.max(1, Math.ceil(unitTypeTotal / input.pageSize)) },
    locations: { items: locations, total: locationTotal, page: input.locationPage, totalPages: Math.max(1, Math.ceil(locationTotal / input.pageSize)) },
    units: { items: units, total: unitTotal, page: input.unitPage, totalPages: Math.max(1, Math.ceil(unitTotal / input.pageSize)) },
  };
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
  const location = await db.rentalLocation.findFirst({
    where: { id: input.locationId, organizationId: input.organizationId, status: 'ACTIVE' },
  });
  if (!location) throw new RentalInventoryUnavailableError('Rental location is not active in this organization.');
  const total = await db.rentalUnit.count({
    where: { organizationId: input.organizationId, locationId: location.id, status: 'ACTIVE' },
  });
  const units = await db.rentalUnit.findMany({
    where: { organizationId: input.organizationId, locationId: location.id, status: 'ACTIVE' },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    include: { unitType: { select: { name: true, code: true } } },
    ...pagination(input.unitPage, input.pageSize),
  });
  return { location, units: { items: units, total, page: input.unitPage, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) } };
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
  const unitType = await db.rentalUnitType.findFirst({
    where: { id: input.unitTypeId, organizationId: input.organizationId, status: 'ACTIVE' },
  });
  if (!unitType) throw new RentalInventoryUnavailableError('Rental unit type is not active in this organization.');
  const [unitTotal, units, rateTotal, rates] = await db.$transaction([
    db.rentalUnit.count({ where: { organizationId: input.organizationId, unitTypeId: unitType.id, status: 'ACTIVE' } }),
    db.rentalUnit.findMany({
      where: { organizationId: input.organizationId, unitTypeId: unitType.id, status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: { location: { select: { name: true, code: true } } },
      ...pagination(input.unitPage, input.pageSize),
    }),
    db.rentalRatePeriod.count({ where: { organizationId: input.organizationId, unitTypeId: unitType.id } }),
    db.rentalRatePeriod.findMany({
      where: { organizationId: input.organizationId, unitTypeId: unitType.id },
      orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
      ...pagination(input.ratePage, input.pageSize),
    }),
  ]);
  return {
    unitType,
    units: { items: units, total: unitTotal, page: input.unitPage, totalPages: Math.max(1, Math.ceil(unitTotal / input.pageSize)) },
    rates: { items: rates, total: rateTotal, page: input.ratePage, totalPages: Math.max(1, Math.ceil(rateTotal / input.pageSize)) },
  };
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
  const unit = await db.rentalUnit.findFirst({
    where: { id: input.unitId, organizationId: input.organizationId, status: 'ACTIVE' },
    include: { unitType: true, location: true },
  });
  if (!unit) throw new RentalInventoryUnavailableError('Rental unit is not active in this organization.');
  const total = await db.rentalAvailabilityBlock.count({ where: { organizationId: input.organizationId, unitId: unit.id } });
  const blocks = await db.rentalAvailabilityBlock.findMany({
    where: { organizationId: input.organizationId, unitId: unit.id },
    orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
    ...pagination(input.blockPage, input.pageSize),
  });
  return { unit, blocks: { items: blocks, total, page: input.blockPage, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) } };
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
      const [unitType, location] = await Promise.all([
        transaction.rentalUnitType.findFirst({
          where: { id: unit.unitTypeId, organizationId: input.organizationId, status: 'ACTIVE' },
          select: { id: true, code: true },
        }),
        transaction.rentalLocation.findFirst({
          where: { organizationId: input.organizationId, code: unit.locationCode, status: 'ACTIVE' },
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
    const [unit, location] = await Promise.all([
      transaction.rentalUnit.findFirst({
        where: { id: input.unitId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true, locationId: true, code: true },
      }),
      transaction.rentalLocation.findFirst({
        where: { organizationId: input.organizationId, code: locationCode, status: 'ACTIVE' },
        select: { id: true, code: true },
      }),
    ]);
    if (!unit) throw new RentalInventoryUnavailableError('Rental unit is not active in this organization.');
    if (!location) throw new RentalInventoryUnavailableError('Rental location is not active in this organization.');
    if (unit.locationId === location.id) return unit;

    const now = await readRentalInventoryDatabaseClock(transaction, 'rental unit relocation');
    const activeHold = await transaction.rentalAvailabilityHold.findFirst({
      where: {
        organizationId: input.organizationId,
        unitId: unit.id,
        status: 'ACTIVE',
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (activeHold) {
      throw new RentalInventoryConflictError(
        'Release active rental availability holds before relocating this rental unit.',
      );
    }

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
    const [unit, overlap, overlappingHold] = await Promise.all([
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
    ]);
    if (!unit) throw new RentalInventoryUnavailableError('Rental unit is not active in this organization.');
    if (overlap) throw new RentalInventoryConflictError('That availability block overlaps an existing block for this rental unit.');
    if (overlappingHold) {
      throw new RentalInventoryConflictError(
        'Release the overlapping rental availability hold before adding this unavailable-date block.',
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
    const current = await transaction.rentalLocation.findFirst({
      where: { id: input.locationId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    if (!current) throw new RentalInventoryUnavailableError('Rental location is not active in this organization.');
    const activeUnits = await transaction.rentalUnit.count({
      where: { organizationId: input.organizationId, locationId: current.id, status: 'ACTIVE' },
    });
    if (activeUnits > 0) throw new RentalInventoryDependencyError('Move or archive active rental units before archiving this location.');
    const archivedAt = new Date();
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
    const current = await transaction.rentalUnitType.findFirst({
      where: { id: input.unitTypeId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    if (!current) throw new RentalInventoryUnavailableError('Rental unit type is not active in this organization.');
    const activeUnits = await transaction.rentalUnit.count({
      where: { organizationId: input.organizationId, unitTypeId: current.id, status: 'ACTIVE' },
    });
    if (activeUnits > 0) throw new RentalInventoryDependencyError('Archive active rental units before archiving this unit type.');
    const archivedAt = new Date();
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
    const activeHold = await transaction.rentalAvailabilityHold.findFirst({
      where: {
        organizationId: input.organizationId,
        unitId: current.id,
        status: 'ACTIVE',
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (activeHold) {
      throw new RentalInventoryConflictError(
        'Release active rental availability holds before archiving this rental unit.',
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
