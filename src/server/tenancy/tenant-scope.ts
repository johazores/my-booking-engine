export interface TenantActorScopeInput {
  organizationId: string;
  userId: string;
}

export interface TenantResourceScopeInput extends TenantActorScopeInput {
  resourceId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuidIdentifier(value: string, fieldName: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a valid UUID.`);
  }

  return value;
}

export function activeOrganizationMembershipScope(userId: string) {
  assertUuidIdentifier(userId, 'userId');

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
  assertUuidIdentifier(organizationId, 'organizationId');

  return {
    id: organizationId,
    ...activeOrganizationMembershipScope(userId),
  };
}

export function tenantOwnedResourceScope({
  organizationId,
  resourceId,
}: Omit<TenantResourceScopeInput, 'userId'>) {
  assertUuidIdentifier(organizationId, 'organizationId');
  assertUuidIdentifier(resourceId, 'resourceId');

  return {
    id: resourceId,
    organizationId,
  };
}

export function tenantOwnedCollectionScope(organizationId: string) {
  assertUuidIdentifier(organizationId, 'organizationId');

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
