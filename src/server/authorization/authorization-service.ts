import { db } from '../database.ts';
import { activeOrganizationAccessScope, assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  organizationRoleHasPermission,
  type OrganizationPermission,
  type OrganizationRole,
} from './authorization-domain.ts';

export class OrganizationPermissionDeniedError extends Error {
  constructor() {
    super('You do not have permission to perform this organization action.');
    this.name = 'OrganizationPermissionDeniedError';
  }
}

export async function readOrganizationAuthorization(input: {
  organizationId: string;
  userId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.userId, 'userId');

  const user = await db.user.findFirst({
    where: { id: input.userId, status: 'ACTIVE' },
    select: { platformRole: true },
  });

  if (!user) return null;
  if (user.platformRole === 'ADMIN') {
    const organization = await db.organization.findFirst({
      where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    return organization ? { platformAdmin: true, role: null as OrganizationRole | null } : null;
  }

  const membership = await db.organizationMembership.findFirst({
    where: {
      organizationId: input.organizationId,
      userId: input.userId,
      status: 'ACTIVE',
      organization: { is: activeOrganizationAccessScope(input) },
    },
    select: { role: true },
  });

  return membership ? { platformAdmin: false, role: membership.role as OrganizationRole } : null;
}

export async function requireOrganizationPermission(input: {
  organizationId: string;
  userId: string;
  permission: OrganizationPermission;
}) {
  const authorization = await readOrganizationAuthorization(input);
  if (!authorization) throw new OrganizationPermissionDeniedError();
  if (authorization.platformAdmin) return authorization;
  if (!authorization.role || !organizationRoleHasPermission(authorization.role, input.permission)) {
    throw new OrganizationPermissionDeniedError();
  }
  return authorization;
}
