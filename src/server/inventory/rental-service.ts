import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  assertRentalArchiveConfirmation,
  assertRentalRemoveConfirmation,
  normalizeRentalAvailabilityBlockInput,
  normalizeRentalRatePeriodInput,
  normalizeRentalUnitInput,
  normalizeRentalUnitTypeInput,
  type RentalAvailabilityBlockInput,
  type RentalRatePeriodInput,
  type RentalUnitInput,
  type RentalUnitTypeInput,
} from './rental-domain.ts';

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

function pagination(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export async function listRentalInventory(input: {
  organizationId: string;
  actorUserId: string;
  unitTypePage: number;
  unitPage: number;
  pageSize: number;
}) {
  await requireRentalPermission(input, 'inventory:read');
  const [unitTypeTotal, unitTypes, unitTotal, units] = await db.$transaction([
    db.rentalUnitType.count({ where: { organizationId: input.organizationId, status: 'ACTIVE' } }),
    db.rentalUnitType.findMany({
      where: { organizationId: input.organizationId, status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...pagination(input.unitTypePage, input.pageSize),
    }),
    db.rentalUnit.count({ where: { organizationId: input.organizationId, status: 'ACTIVE' } }),
    db.rentalUnit.findMany({
      where: { organizationId: input.organizationId, status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: { unitType: { select: { name: true, code: true, currency: true } } },
      ...pagination(input.unitPage, input.pageSize),
    }),
  ]);
  return {
    unitTypes: { items: unitTypes, total: unitTypeTotal, page: input.unitTypePage, totalPages: Math.max(1, Math.ceil(unitTypeTotal / input.pageSize)) },
    units: { items: units, total: unitTotal, page: input.unitPage, totalPages: Math.max(1, Math.ceil(unitTotal / input.pageSize)) },
  };
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
    include: { unitType: true },
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
      const unitType = await transaction.rentalUnitType.findFirst({
        where: { id: unit.unitTypeId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true, code: true },
      });
      if (!unitType) throw new RentalInventoryUnavailableError('Rental unit type is not active in this organization.');
      const created = await transaction.rentalUnit.create({ data: { organizationId: input.organizationId, ...unit } });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.rental-unit.created',
          resourceType: 'rental-unit',
          resourceId: created.id,
          afterData: { code: created.code, unitTypeId: created.unitTypeId, unitTypeCode: unitType.code, status: created.status },
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

export async function createRentalAvailabilityBlock(input: {
  organizationId: string;
  actorUserId: string;
  block: RentalAvailabilityBlockInput;
}) {
  await requireRentalPermission(input, 'inventory:manage');
  const block = normalizeRentalAvailabilityBlockInput(input.block);
  assertUuidIdentifier(block.unitId, 'unitId');
  return db.$transaction(async (transaction) => {
    const unit = await transaction.rentalUnit.findFirst({
      where: { id: block.unitId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, code: true },
    });
    if (!unit) throw new RentalInventoryUnavailableError('Rental unit is not active in this organization.');
    const overlap = await transaction.rentalAvailabilityBlock.findFirst({
      where: {
        organizationId: input.organizationId,
        unitId: unit.id,
        startsOn: { lt: block.endsOn },
        endsOn: { gt: block.startsOn },
      },
      select: { id: true },
    });
    if (overlap) throw new RentalInventoryConflictError('That availability block overlaps an existing block for this rental unit.');
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
    const updated = await transaction.rentalUnitType.update({ where: { id: current.id }, data: { status: 'ARCHIVED', archivedAt } });
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
    const current = await transaction.rentalUnit.findFirst({
      where: { id: input.unitId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    if (!current) throw new RentalInventoryUnavailableError('Rental unit is not active in this organization.');
    const archivedAt = new Date();
    const updated = await transaction.rentalUnit.update({ where: { id: current.id }, data: { status: 'ARCHIVED', archivedAt } });
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
    await transaction.rentalAvailabilityBlock.delete({ where: { id: current.id } });
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
    await transaction.rentalRatePeriod.delete({ where: { id: current.id } });
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
