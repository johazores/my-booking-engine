import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isOrganizationRole,
  organizationRoleHasPermission,
  permissionsForOrganizationRole,
} from './authorization-domain.ts';

test('organization roles expose explicit capabilities', () => {
  assert.equal(organizationRoleHasPermission('ADMIN', 'membership-role:manage'), true);
  assert.equal(organizationRoleHasPermission('MANAGER', 'membership:manage'), true);
  assert.equal(organizationRoleHasPermission('MANAGER', 'membership-role:manage'), false);
  assert.equal(organizationRoleHasPermission('STAFF', 'membership:read'), true);
  assert.equal(organizationRoleHasPermission('CUSTOMER', 'membership:read'), false);
});

test('role parsing accepts only supported organization roles', () => {
  for (const role of ['ADMIN', 'MANAGER', 'STAFF', 'CUSTOMER']) assert.equal(isOrganizationRole(role), true);
  for (const role of ['', 'OWNER', 'admin', 'PLATFORM_ADMIN']) assert.equal(isOrganizationRole(role), false);
});

test('permission lists are stable and least-privilege by default', () => {
  assert.deepEqual(permissionsForOrganizationRole('CUSTOMER'), []);
  assert.deepEqual(permissionsForOrganizationRole('STAFF'), ['membership:read']);
});
