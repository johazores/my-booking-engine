import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  assertCustomerArchiveConfirmation,
  normalizeCustomerInput,
  type CustomerInput,
} from './customer-domain.ts';
import {
  listCustomerActivityForOrganization,
  listCustomersForOrganization,
  readCustomerForOrganization,
} from './customer-repository.ts';

export class CustomerConflictError extends Error {
  constructor() {
    super('A customer with that email already exists in this organization.');
    this.name = 'CustomerConflictError';
  }
}

export class CustomerUnavailableError extends Error {
  constructor() {
    super('Customer is not available in this organization.');
    this.name = 'CustomerUnavailableError';
  }
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function listCustomers(input: {
  organizationId: string;
  actorUserId: string;
  search: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'ALL';
  sort: 'newest' | 'oldest' | 'name-asc' | 'name-desc';
  page: number;
  pageSize: number;
}) {
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'customer:read',
  });
  return listCustomersForOrganization(input);
}

export async function readCustomer(input: {
  organizationId: string;
  actorUserId: string;
  customerId: string;
}) {
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'customer:read',
  });
  return readCustomerForOrganization({ organizationId: input.organizationId, customerId: input.customerId });
}

export async function readCustomerWithActivity(input: {
  organizationId: string;
  actorUserId: string;
  customerId: string;
}) {
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'customer:read',
  });
  const customer = await readCustomerForOrganization({ organizationId: input.organizationId, customerId: input.customerId });
  if (!customer) return null;
  const activity = await listCustomerActivityForOrganization({
    organizationId: input.organizationId,
    customerId: input.customerId,
  });
  return { customer, activity };
}

export async function createCustomer(input: {
  organizationId: string;
  actorUserId: string;
  customer: CustomerInput;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'customer:manage',
  });
  const customer = normalizeCustomerInput(input.customer);

  try {
    return await db.$transaction(async (transaction) => {
      const created = await transaction.customer.create({
        data: { organizationId: input.organizationId, ...customer },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'customer.created',
          resourceType: 'customer',
          resourceId: created.id,
          afterData: { status: created.status },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new CustomerConflictError();
    throw error;
  }
}

export async function updateCustomer(input: {
  organizationId: string;
  actorUserId: string;
  customerId: string;
  customer: CustomerInput;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.customerId, 'customerId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'customer:manage',
  });
  const next = normalizeCustomerInput(input.customer);

  try {
    return await db.$transaction(async (transaction) => {
      const current = await transaction.customer.findFirst({
        where: { id: input.customerId, organizationId: input.organizationId, status: 'ACTIVE' },
      });
      if (!current) throw new CustomerUnavailableError();

      const changedFields = (['firstName', 'lastName', 'email', 'phone', 'notes'] as const)
        .filter((field) => current[field] !== next[field]);
      if (changedFields.length === 0) return current;

      const updated = await transaction.customer.update({
        where: { id: current.id },
        data: next,
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'customer.updated',
          resourceType: 'customer',
          resourceId: current.id,
          afterData: { changedFields },
        },
      });
      return updated;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new CustomerConflictError();
    throw error;
  }
}

export async function archiveCustomer(input: {
  organizationId: string;
  actorUserId: string;
  customerId: string;
  confirmation: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.customerId, 'customerId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'customer:manage',
  });
  assertCustomerArchiveConfirmation(input.confirmation);

  return db.$transaction(async (transaction) => {
    const current = await transaction.customer.findFirst({
      where: { id: input.customerId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    if (!current) throw new CustomerUnavailableError();

    const archivedAt = new Date();
    const updated = await transaction.customer.update({
      where: { id: current.id },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'customer.archived',
        resourceType: 'customer',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
