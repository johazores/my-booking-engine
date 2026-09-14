import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  assertTourArchiveConfirmation,
  normalizeTourAddonInput,
  normalizeTourDepartureInput,
  normalizeTourProductInput,
  type TourAddonInput,
  type TourDepartureInput,
  type TourProductInput,
} from './tour-domain.ts';
import {
  listTourProductsForOrganization,
  readTourProductForOrganization,
} from './tour-repository.ts';

export class TourInventoryConflictError extends Error {
  constructor(message = 'A tour inventory record already exists in this scope.') {
    super(message);
    this.name = 'TourInventoryConflictError';
  }
}

export class TourInventoryUnavailableError extends Error {
  constructor(message = 'Tour inventory is not available in this organization.') {
    super(message);
    this.name = 'TourInventoryUnavailableError';
  }
}

export class TourInventoryDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TourInventoryDependencyError';
  }
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

async function requireInventoryRead(input: { organizationId: string; actorUserId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'inventory:read',
  });
}

async function requireInventoryManage(input: { organizationId: string; actorUserId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'inventory:manage',
  });
}

export async function listTourProducts(input: { organizationId: string; actorUserId: string; page: number; pageSize: number }) {
  await requireInventoryRead(input);
  return listTourProductsForOrganization(input);
}

export async function readTourProduct(input: { organizationId: string; actorUserId: string; tourProductId: string }) {
  await requireInventoryRead(input);
  const product = await readTourProductForOrganization(input);
  if (!product) throw new TourInventoryUnavailableError();
  return product;
}

export async function createTourProduct(input: {
  organizationId: string;
  actorUserId: string;
  product: TourProductInput;
}) {
  await requireInventoryManage(input);
  const product = normalizeTourProductInput(input.product);
  try {
    return await db.$transaction(async (transaction) => {
      const created = await transaction.tourProduct.create({
        data: { organizationId: input.organizationId, ...product },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.tour-product.created',
          resourceType: 'tour-product',
          resourceId: created.id,
          afterData: { kind: created.kind, code: created.code, status: created.status },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new TourInventoryConflictError('A tour or package with that code already exists in this organization.');
    }
    throw error;
  }
}

export async function createTourDeparture(input: {
  organizationId: string;
  actorUserId: string;
  tourProductId: string;
  departure: TourDepartureInput;
}) {
  await requireInventoryManage(input);
  assertUuidIdentifier(input.tourProductId, 'tourProductId');
  const departure = normalizeTourDepartureInput(input.departure);
  try {
    return await db.$transaction(async (transaction) => {
      const product = await transaction.tourProduct.findFirst({
        where: { id: input.tourProductId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!product) throw new TourInventoryUnavailableError('Tour or package is not active in this organization.');
      const created = await transaction.tourDeparture.create({
        data: {
          organizationId: input.organizationId,
          tourProductId: product.id,
          ...departure,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.tour-departure.created',
          resourceType: 'tour-departure',
          resourceId: created.id,
          afterData: {
            tourProductId: created.tourProductId,
            startsAt: created.startsAt.toISOString(),
            endsAt: created.endsAt.toISOString(),
            capacity: created.capacity,
            status: created.status,
          },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new TourInventoryConflictError('A departure already exists for this tour or package at that start time.');
    }
    throw error;
  }
}

export async function createTourAddon(input: {
  organizationId: string;
  actorUserId: string;
  tourProductId: string;
  addon: TourAddonInput;
}) {
  await requireInventoryManage(input);
  assertUuidIdentifier(input.tourProductId, 'tourProductId');
  const addon = normalizeTourAddonInput(input.addon);
  try {
    return await db.$transaction(async (transaction) => {
      const product = await transaction.tourProduct.findFirst({
        where: { id: input.tourProductId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!product) throw new TourInventoryUnavailableError('Tour or package is not active in this organization.');
      const created = await transaction.tourAddon.create({
        data: {
          organizationId: input.organizationId,
          tourProductId: product.id,
          ...addon,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'inventory.tour-addon.created',
          resourceType: 'tour-addon',
          resourceId: created.id,
          afterData: {
            tourProductId: created.tourProductId,
            code: created.code,
            maxQuantityPerBooking: created.maxQuantityPerBooking,
            status: created.status,
          },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new TourInventoryConflictError('An add-on with that code already exists for this tour or package.');
    }
    throw error;
  }
}

export async function archiveTourDeparture(input: {
  organizationId: string;
  actorUserId: string;
  tourProductId: string;
  departureId: string;
  confirmation: string;
}) {
  await requireInventoryManage(input);
  assertUuidIdentifier(input.tourProductId, 'tourProductId');
  assertUuidIdentifier(input.departureId, 'departureId');
  assertTourArchiveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    const current = await transaction.tourDeparture.findFirst({
      where: {
        id: input.departureId,
        tourProductId: input.tourProductId,
        organizationId: input.organizationId,
        status: 'ACTIVE',
      },
      select: { id: true, status: true },
    });
    if (!current) throw new TourInventoryUnavailableError('Departure is not active in this organization.');
    const archivedAt = new Date();
    const updated = await transaction.tourDeparture.update({
      where: { id: current.id },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.tour-departure.archived',
        resourceType: 'tour-departure',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveTourAddon(input: {
  organizationId: string;
  actorUserId: string;
  tourProductId: string;
  addonId: string;
  confirmation: string;
}) {
  await requireInventoryManage(input);
  assertUuidIdentifier(input.tourProductId, 'tourProductId');
  assertUuidIdentifier(input.addonId, 'addonId');
  assertTourArchiveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    const current = await transaction.tourAddon.findFirst({
      where: {
        id: input.addonId,
        tourProductId: input.tourProductId,
        organizationId: input.organizationId,
        status: 'ACTIVE',
      },
      select: { id: true, status: true },
    });
    if (!current) throw new TourInventoryUnavailableError('Add-on is not active in this organization.');
    const archivedAt = new Date();
    const updated = await transaction.tourAddon.update({
      where: { id: current.id },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.tour-addon.archived',
        resourceType: 'tour-addon',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveTourProduct(input: {
  organizationId: string;
  actorUserId: string;
  tourProductId: string;
  confirmation: string;
}) {
  await requireInventoryManage(input);
  assertUuidIdentifier(input.tourProductId, 'tourProductId');
  assertTourArchiveConfirmation(input.confirmation);
  return db.$transaction(async (transaction) => {
    const current = await transaction.tourProduct.findFirst({
      where: { id: input.tourProductId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    if (!current) throw new TourInventoryUnavailableError('Tour or package is not active in this organization.');
    const [activeDepartures, activeAddons] = await Promise.all([
      transaction.tourDeparture.count({
        where: { organizationId: input.organizationId, tourProductId: current.id, status: 'ACTIVE' },
      }),
      transaction.tourAddon.count({
        where: { organizationId: input.organizationId, tourProductId: current.id, status: 'ACTIVE' },
      }),
    ]);
    if (activeDepartures > 0 || activeAddons > 0) {
      throw new TourInventoryDependencyError('Archive active departures and add-ons before archiving the tour or package.');
    }
    const archivedAt = new Date();
    const updated = await transaction.tourProduct.update({
      where: { id: current.id },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'inventory.tour-product.archived',
        resourceType: 'tour-product',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
