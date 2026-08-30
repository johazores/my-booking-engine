import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeOrganizationAccessScope,
  activeOrganizationMembershipScope,
  tenantOwnedCollectionScope,
  tenantOwnedResourceScope,
} from './tenant-scope.ts';

test('organization access always requires an active membership for the requesting user', () => {
  assert.deepEqual(activeOrganizationMembershipScope('user-a'), {
    deletedAt: null,
    status: 'ACTIVE',
    memberships: {
      some: {
        userId: 'user-a',
        status: 'ACTIVE',
      },
    },
  });

  assert.deepEqual(
    activeOrganizationAccessScope({ organizationId: 'tenant-a', userId: 'user-a' }),
    {
      id: 'tenant-a',
      deletedAt: null,
      status: 'ACTIVE',
      memberships: {
        some: {
          userId: 'user-a',
          status: 'ACTIVE',
        },
      },
    },
  );
});

test('tenant-owned resource scopes always bind both resource and organization identifiers', () => {
  assert.deepEqual(
    tenantOwnedResourceScope({ organizationId: 'tenant-a', resourceId: 'resource-1' }),
    {
      id: 'resource-1',
      organizationId: 'tenant-a',
    },
  );

  assert.notDeepEqual(
    tenantOwnedResourceScope({ organizationId: 'tenant-a', resourceId: 'resource-1' }),
    tenantOwnedResourceScope({ organizationId: 'tenant-b', resourceId: 'resource-1' }),
  );
});

test('tenant-owned collection scopes cannot omit organization ownership', () => {
  assert.deepEqual(tenantOwnedCollectionScope('tenant-a'), {
    organizationId: 'tenant-a',
  });
});
