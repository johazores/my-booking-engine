import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  CUSTOMER_PAGE_SIZE_DEFAULT,
  CUSTOMER_PAGE_SIZE_MAX,
  type CustomerSort,
  type CustomerStatus,
} from './customer-domain.ts';

function customerOrderBy(sort: CustomerSort) {
  if (sort === 'oldest') return [{ createdAt: 'asc' as const }, { id: 'asc' as const }];
  if (sort === 'name-asc') return [{ lastName: 'asc' as const }, { firstName: 'asc' as const }, { id: 'asc' as const }];
  if (sort === 'name-desc') return [{ lastName: 'desc' as const }, { firstName: 'desc' as const }, { id: 'asc' as const }];
  return [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
}

function normalizeCustomerPagination(pageInput: number, pageSizeInput: number) {
  const page = Number.isSafeInteger(pageInput) && pageInput > 0 ? pageInput : 1;
  const pageSize = Number.isSafeInteger(pageSizeInput) && pageSizeInput > 0
    ? Math.min(pageSizeInput, CUSTOMER_PAGE_SIZE_MAX)
    : CUSTOMER_PAGE_SIZE_DEFAULT;
  return { page, pageSize };
}

export async function listCustomersForOrganization(input: {
  organizationId: string;
  search: string;
  status: CustomerStatus | 'ALL';
  sort: CustomerSort;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const where = {
    organizationId: input.organizationId,
    ...(input.status === 'ALL' ? {} : { status: input.status }),
    ...(input.search ? {
      OR: [
        { firstName: { contains: input.search, mode: 'insensitive' as const } },
        { lastName: { contains: input.search, mode: 'insensitive' as const } },
        { email: { contains: input.search, mode: 'insensitive' as const } },
        { phone: { contains: input.search, mode: 'insensitive' as const } },
      ],
    } : {}),
  };

  const pagination = normalizeCustomerPagination(input.page, input.pageSize);
  return db.$transaction(async (transaction) => {
    const total = await transaction.customer.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    const page = Math.min(pagination.page, totalPages);
    const customers = await transaction.customer.findMany({
      where,
      orderBy: customerOrderBy(input.sort),
      skip: (page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return { customers, total, page, totalPages, pageSize: pagination.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function readCustomerForOrganization(input: { organizationId: string; customerId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.customerId, 'customerId');
  return db.customer.findFirst({
    where: { id: input.customerId, organizationId: input.organizationId },
  });
}

export async function listCustomerActivityForOrganization(input: {
  organizationId: string;
  customerId: string;
  limit?: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.customerId, 'customerId');
  return db.auditEvent.findMany({
    where: {
      organizationId: input.organizationId,
      resourceType: 'customer',
      resourceId: input.customerId,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(input.limit ?? 30, 1), 100),
    select: {
      id: true,
      action: true,
      afterData: true,
      createdAt: true,
      actorUser: { select: { id: true, displayName: true, email: true } },
    },
  });
}

export async function readCustomerDeidentificationForOrganization(input: {
  organizationId: string;
  customerId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.customerId, 'customerId');
  return db.auditEvent.findFirst({
    where: {
      organizationId: input.organizationId,
      resourceType: 'customer',
      resourceId: input.customerId,
      action: 'customer.deidentified',
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true },
  });
}
