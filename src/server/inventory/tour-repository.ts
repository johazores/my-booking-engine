import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { resolveInventoryPagination } from './inventory-pagination.ts';

export async function listTourProductsForOrganization(input: { organizationId: string; page: number; pageSize: number }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const where = { organizationId: input.organizationId };

  return db.$transaction(async (transaction) => {
    const total = await transaction.tourProduct.count({ where });
    const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
    const products = await transaction.tourProduct.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        _count: {
          select: { departures: true, addons: true },
        },
      },
    });
    return { products, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function readTourProductForOrganization(input: { organizationId: string; tourProductId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.tourProductId, 'tourProductId');
  return db.tourProduct.findFirst({
    where: { id: input.tourProductId, organizationId: input.organizationId },
  });
}

export async function listTourDeparturesForProduct(input: {
  organizationId: string;
  tourProductId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.tourProductId, 'tourProductId');
  const where = { organizationId: input.organizationId, tourProductId: input.tourProductId };

  return db.$transaction(async (transaction) => {
    const total = await transaction.tourDeparture.count({ where });
    const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
    const departures = await transaction.tourDeparture.findMany({
      where,
      orderBy: [{ status: 'asc' }, { startsAt: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
    });
    return { departures, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function listTourAddonsForProduct(input: {
  organizationId: string;
  tourProductId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.tourProductId, 'tourProductId');
  const where = { organizationId: input.organizationId, tourProductId: input.tourProductId };

  return db.$transaction(async (transaction) => {
    const total = await transaction.tourAddon.count({ where });
    const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
    const addons = await transaction.tourAddon.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
    });
    return { addons, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}
