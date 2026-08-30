export interface TenantActorScopeInput {
  organizationId: string;
  userId: string;
}

export interface TenantResourceScopeInput extends TenantActorScopeInput {
  resourceId: string;
}

export function activeOrganizationMembershipScope(userId: string) {
  return {
    deletedAt: null,
    status: 'ACTIVE' as const,
    memberships: {
      some: {
        userId,
        status: 'ACTIVE' as const,
        user: {
          is: {
            status: 'ACTIVE' as const,
          },
        },
      },
    },
  };
}

export function activeOrganizationAccessScope({
  organizationId,
  userId,
}: TenantActorScopeInput) {
  return {
    id: organizationId,
    ...activeOrganizationMembershipScope(userId),
  };
}

export function tenantOwnedResourceScope({
  organizationId,
  resourceId,
}: Omit<TenantResourceScopeInput, 'userId'>) {
  return {
    id: resourceId,
    organizationId,
  };
}

export function tenantOwnedCollectionScope(organizationId: string) {
  return {
    organizationId,
  };
}

export function activeTenantOwnedCollectionScope(input: TenantActorScopeInput) {
  return {
    ...tenantOwnedCollectionScope(input.organizationId),
    organization: {
      is: activeOrganizationAccessScope(input),
    },
  };
}

export function activeTenantOwnedResourceScope({
  organizationId,
  userId,
  resourceId,
}: TenantResourceScopeInput) {
  return {
    ...tenantOwnedResourceScope({ organizationId, resourceId }),
    organization: {
      is: activeOrganizationAccessScope({ organizationId, userId }),
    },
  };
}
