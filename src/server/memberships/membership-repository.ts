import { db } from '../database.ts';
import {
  activeTenantOwnedCollectionScope,
  activeTenantOwnedResourceScope,
  type TenantActorScopeInput,
} from '../tenancy/tenant-scope.ts';

interface MembershipAccessInput extends TenantActorScopeInput {
  membershipId: string;
}

export function listMembershipsForOrganization(input: TenantActorScopeInput) {
  return db.organizationMembership.findMany({
    where: activeTenantOwnedCollectionScope(input),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      organizationId: true,
      userId: true,
      status: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
        },
      },
    },
  });
}

export function findMembershipForOrganization({
  membershipId,
  organizationId,
  userId,
}: MembershipAccessInput) {
  return db.organizationMembership.findFirst({
    where: activeTenantOwnedResourceScope({
      organizationId,
      userId,
      resourceId: membershipId,
    }),
    select: {
      id: true,
      organizationId: true,
      userId: true,
      status: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
        },
      },
    },
  });
}
