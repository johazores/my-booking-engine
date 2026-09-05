import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  DEIDENTIFIED_CUSTOMER_FIRST_NAME,
  DEIDENTIFIED_CUSTOMER_LAST_NAME,
  assertCustomerArchiveConfirmation,
  assertCustomerDeidentificationConfirmation,
  normalizeCustomerInput,
  type CustomerInput,
} from './customer-domain.ts';
import {
  listCustomerActivityForOrganization,
  listCustomersForOrganization,
  readCustomerDeidentificationForOrganization,
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

export class CustomerDeidentificationBlockedError extends Error {
  constructor() {
    super('Customer profile de-identification is unavailable while booking records reference this customer.');
    this.name = 'CustomerDeidentificationBlockedError';
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
  const [activity, deidentification] = await Promise.all([
    listCustomerActivityForOrganization({
      organizationId: input.organizationId,
      customerId: input.customerId,
    }),
    readCustomerDeidentificationForOrganization({
      organizationId: input.organizationId,
      customerId: input.customerId,
    }),
  ]);

  const bookingReferenceCount = customer.status === 'ARCHIVED' && !deidentification
    ? await db.hospitalityBooking.count({
        where: { organizationId: input.organizationId, customerId: input.customerId },
      })
    : 0;
  const deidentificationEligibility = deidentification
    ? { allowed: false, reason: 'ALREADY_DEIDENTIFIED' as const }
    : customer.status !== 'ARCHIVED'
      ? { allowed: false, reason: 'NOT_ARCHIVED' as const }
      : bookingReferenceCount > 0
        ? { allowed: false, reason: 'BOOKING_REFERENCES' as const }
        : { allowed: true, reason: null };

  return { customer, activity, deidentification, deidentificationEligibility };
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

export async function deidentifyCustomerProfile(input: {
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
  assertCustomerDeidentificationConfirmation(input.confirmation);

  return db.$transaction(async (transaction) => {
    const current = await transaction.customer.findFirst({
      where: { id: input.customerId, organizationId: input.organizationId, status: 'ARCHIVED' },
      select: { id: true, status: true },
    });
    if (!current) throw new CustomerUnavailableError();

    const existingEvidence = await transaction.auditEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        resourceType: 'customer',
        resourceId: current.id,
        action: 'customer.deidentified',
      },
      select: { id: true },
    });
    if (existingEvidence) throw new CustomerUnavailableError();

    const bookingReferenceCount = await transaction.hospitalityBooking.count({
      where: { organizationId: input.organizationId, customerId: current.id },
    });
    if (bookingReferenceCount > 0) throw new CustomerDeidentificationBlockedError();

    const updated = await transaction.customer.update({
      where: { id: current.id },
      data: {
        firstName: DEIDENTIFIED_CUSTOMER_FIRST_NAME,
        lastName: DEIDENTIFIED_CUSTOMER_LAST_NAME,
        email: null,
        phone: null,
        notes: null,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'customer.deidentified',
        resourceType: 'customer',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: {
          status: current.status,
          clearedFields: ['firstName', 'lastName', 'email', 'phone', 'notes'],
        },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
