import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  canTransitionMembershipStatus,
  isMembershipLifecycleStatus,
  type MembershipLifecycleStatus,
} from './membership-domain.ts';

export class MembershipStatusValidationError extends Error {
  constructor(message = 'Choose a valid membership status transition.') {
    super(message);
    this.name = 'MembershipStatusValidationError';
  }
}

export class MembershipStatusConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MembershipStatusConflictError';
  }
}

export async function updateMembershipStatus(input: {
  organizationId: string;
  actorUserId: string;
  membershipId: string;
  status: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.membershipId, 'membershipId');
  if (!isMembershipLifecycleStatus(input.status)) throw new MembershipStatusValidationError();

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'membership:manage',
  });

  return db.$transaction(async (transaction) => {
    const membership = await transaction.organizationMembership.findFirst({
      where: { id: input.membershipId, organizationId: input.organizationId },
      select: { id: true, userId: true, role: true, status: true },
    });

    if (!membership) throw new MembershipStatusValidationError();
    if (membership.status === input.status) return membership;
    if (!canTransitionMembershipStatus(membership.status as MembershipLifecycleStatus, input.status)) {
      throw new MembershipStatusValidationError();
    }

    if (membership.role === 'ADMIN' && membership.status === 'ACTIVE' && input.status !== 'ACTIVE') {
      const activeAdminCount = await transaction.organizationMembership.count({
        where: { organizationId: input.organizationId, role: 'ADMIN', status: 'ACTIVE' },
      });
      if (activeAdminCount <= 1) {
        throw new MembershipStatusConflictError('An organization must keep at least one active administrator.');
      }
    }

    const updated = await transaction.organizationMembership.update({
      where: { id: membership.id },
      data: { status: input.status },
      select: { id: true, userId: true, role: true, status: true },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'membership.status.changed',
        resourceType: 'organization-membership',
        resourceId: membership.id,
        beforeData: { status: membership.status },
        afterData: { status: updated.status },
      },
    });

    return updated;
  }, { isolationLevel: 'Serializable' });
}
