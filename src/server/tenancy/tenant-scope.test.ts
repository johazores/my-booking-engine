import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeOrganizationAccessScope,
  activeOrganizationMembershipScope,
  activeTenantOwnedCollectionScope,
  activeTenantOwnedResourceScope,
  assertUuidIdentifier,
  tenantOwnedCollectionScope,
  tenantOwnedResourceScope,
} from './tenant-scope.ts';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const resourceA = '33333333-3333-4333-8333-333333333333';

const activeUserRelationScope = {
  user: {
    is: {
      status: 'ACTIVE',
    },
  },
};

test('tenant identifiers reject malformed UUIDs before repository access', () => {
  assert.equal(assertUuidIdentifier(tenantA, 'organizationId'), tenantA);
  assert.throws(() => assertUuidIdentifier('', 'organizationId'), /valid UUID/);
  assert.throws(() => assertUuidIdentifier('tenant-a', 'organizationId'), /valid UUID/);
  assert.throws(() => activeOrganizationMembershipScope('not-a-user-id'), /valid UUID/);
  assert.throws(() => tenantOwnedCollectionScope(''), /valid UUID/);
  assert.throws(
    () => tenantOwnedResourceScope({ organizationId: tenantA, resourceId: 'resource-1' }),
    /valid UUID/,
  );
});

test('organization access requires both an active membership and active requesting user', () => {
  assert.deepEqual(activeOrganizationMembershipScope(userA), {
    deletedAt: null,
    status: 'ACTIVE',
    memberships: {
      some: {
        userId: userA,
        status: 'ACTIVE',
        ...activeUserRelationScope,
      },
    },
  });

  assert.deepEqual(
    activeOrganizationAccessScope({ organizationId: tenantA, userId: userA }),
    {
      id: tenantA,
      deletedAt: null,
      status: 'ACTIVE',
      memberships: {
        some: {
          userId: userA,
          status: 'ACTIVE',
          ...activeUserRelationScope,
        },
      },
    },
  );
});

test('tenant-owned resource scopes always bind both resource and organization identifiers', () => {
  assert.deepEqual(
    tenantOwnedResourceScope({ organizationId: tenantA, resourceId: resourceA }),
    {
      id: resourceA,
      organizationId: tenantA,
    },
  );

  assert.notDeepEqual(
    tenantOwnedResourceScope({ organizationId: tenantA, resourceId: resourceA }),
    tenantOwnedResourceScope({ organizationId: tenantB, resourceId: resourceA }),
  );
});

test('tenant-owned collection scopes cannot omit organization ownership', () => {
  assert.deepEqual(tenantOwnedCollectionScope(tenantA), {
    organizationId: tenantA,
  });
});

test('active tenant-owned scopes also require active actor access to the owning organization', () => {
  assert.deepEqual(
    activeTenantOwnedCollectionScope({ organizationId: tenantA, userId: userA }),
    {
      organizationId: tenantA,
      organization: {
        is: {
          id: tenantA,
          deletedAt: null,
          status: 'ACTIVE',
          memberships: {
            some: {
              userId: userA,
              status: 'ACTIVE',
              ...activeUserRelationScope,
            },
          },
        },
      },
    },
  );

  assert.deepEqual(
    activeTenantOwnedResourceScope({
      organizationId: tenantA,
      userId: userA,
      resourceId: resourceA,
    }),
    {
      id: resourceA,
      organizationId: tenantA,
      organization: {
        is: {
          id: tenantA,
          deletedAt: null,
          status: 'ACTIVE',
          memberships: {
            some: {
              userId: userA,
              status: 'ACTIVE',
              ...activeUserRelationScope,
            },
          },
        },
      },
    },
  );
});
