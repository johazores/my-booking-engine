import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  createOrganizationCurrency,
  createOrganizationKind,
  createOrganizationName,
  createOrganizationSlug,
  createOrganizationTimezone,
} from './organization-domain.ts';

export class OrganizationSlugConflictError extends Error {
  constructor() {
    super('Organization slug is already in use.');
    this.name = 'OrganizationSlugConflictError';
  }
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function createOrganizationForUser(input: {
  userId: string;
  name: string;
  slug?: string;
  kind: string;
  timezone: string;
  currency: string;
}) {
  assertUuidIdentifier(input.userId, 'userId');
  const name = createOrganizationName(input.name);
  const slug = createOrganizationSlug(input.slug?.trim() || name);
  const kind = createOrganizationKind(input.kind);
  const timezone = createOrganizationTimezone(input.timezone);
  const currency = createOrganizationCurrency(input.currency);

  try {
    return await db.$transaction(async (transaction) => {
      const organization = await transaction.organization.create({
        data: { name, slug, kind, timezone, currency },
      });
      await transaction.organizationMembership.create({
        data: {
          organizationId: organization.id,
          userId: input.userId,
          status: 'ACTIVE',
          role: 'ADMIN',
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: organization.id,
          actorUserId: input.userId,
          action: 'organization.created',
          resourceType: 'organization',
          resourceId: organization.id,
          afterData: { role: 'ADMIN' },
        },
      });
      return organization;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new OrganizationSlugConflictError();
    throw error;
  }
}
