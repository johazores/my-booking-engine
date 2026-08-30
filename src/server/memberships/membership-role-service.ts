import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { isOrganizationRole, type OrganizationRole } from '../authorization/authorization-domain.ts';

export class MembershipRoleValidationError extends Error {
  constructor() {
    super('Choose a valid organization role.');
    this.name = 'MembershipRoleValidationError';
  }
}

export class MembershipRoleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MembershipRoleConflictError';
  }
}

export async function updateMembershipRole(input: {
  organizationId: string;
  actorUserId: string;
  membershipId: string;
  role: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.membershipId, 'membershipId');
  if (!isOrganizationRole(input.role)) throw new MembershipRoleValidationError();

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'membership-role:manage',
  });

  return db.$transaction(async (transaction) => {
    const membership = await transaction.organizationMembership.findFirst({
      where: { id: input.membershipId, organizationId: input.organizationId },
      select: { id: true, userId: true, role: true, status: true },
    });
    if (!membership || membership.status === 'ARCHIVED') throw new MembershipRoleValidationError();
    if (membership.role === input.role) return membership;

    if (membership.role === 'ADMIN' && input.role !== 'ADMIN' && membership.status === 'ACTIVE') {
      const activeAdminCount = await transaction.organizationMembership.count({
        where: { organizationId: input.organizationId, role: 'ADMIN', status: 'ACTIVE' },
      });
      if (activeAdminCount <= 1) throw new MembershipRoleConflictError('An organization must keep at least one active administrator.');
    }

    const updated = await transaction.organizationMembership.update({
      where: { id: membership.id },
      data: { role: input.role as OrganizationRole },
      select: { id: true, userId: true, role: true, status: true },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'membership.role.changed',
        resourceType: 'organization-membership',
        resourceId: membership.id,
        beforeData: { role: membership.role },
        afterData: { role: updated.role },
      },
    });
    return updated;
  });
}
