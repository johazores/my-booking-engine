import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';

export async function listTourProductsForOrganization(input: { organizationId: string; page: number; pageSize: number }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const where = { organizationId: input.organizationId };
  const total = await db.tourProduct.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const products = await db.tourProduct.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
    include: {
      _count: {
        select: { departures: true, addons: true },
      },
    },
  });
  return { products, total, page, totalPages };
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
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const departures = await db.tourDeparture.findMany({
    where,
    orderBy: [{ status: 'asc' }, { startsAt: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
  });
  return { departures, total, page, totalPages };
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
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const addons = await db.tourAddon.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
  });
  return { addons, total, page, totalPages };
}
