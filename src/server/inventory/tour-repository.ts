import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { resolveInventoryPagination } from './inventory-pagination.ts';

export async function listTourProductsForOrganization(input: { organizationId: string; page: number; pageSize: number }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const where = { organizationId: input.organizationId };
  const total = await db.tourProduct.count({ where });
  const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
  const products = await db.tourProduct.findMany({
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
  const total = await db.tourDeparture.count({ where });
  const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
  const departures = await db.tourDeparture.findMany({
    where,
    orderBy: [{ status: 'asc' }, { startsAt: 'asc' }, { id: 'asc' }],
    skip: pagination.skip,
    take: pagination.take,
  });
  return { departures, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
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
  const total = await db.tourAddon.count({ where });
  const pagination = resolveInventoryPagination({ total, page: input.page, pageSize: input.pageSize });
  const addons = await db.tourAddon.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: pagination.skip,
    take: pagination.take,
  });
  return { addons, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: pagination.pageSize };
}
