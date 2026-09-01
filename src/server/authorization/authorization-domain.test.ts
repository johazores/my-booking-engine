import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isOrganizationRole,
  organizationRoleHasPermission,
  permissionsForOrganizationRole,
} from './authorization-domain.ts';

test('organization roles expose explicit capabilities', () => {
  assert.equal(organizationRoleHasPermission('ADMIN', 'membership-role:manage'), true);
  assert.equal(organizationRoleHasPermission('ADMIN', 'inventory:manage'), true);
  assert.equal(organizationRoleHasPermission('ADMIN', 'availability:manage'), true);
  assert.equal(organizationRoleHasPermission('ADMIN', 'pricing:manage'), true);
  assert.equal(organizationRoleHasPermission('ADMIN', 'booking:manage'), true);
  assert.equal(organizationRoleHasPermission('ADMIN', 'payment:manage'), true);
  assert.equal(organizationRoleHasPermission('ADMIN', 'integration:read'), true);
  assert.equal(organizationRoleHasPermission('ADMIN', 'integration:manage'), true);
  assert.equal(organizationRoleHasPermission('MANAGER', 'membership:manage'), true);
  assert.equal(organizationRoleHasPermission('MANAGER', 'membership-role:manage'), false);
  assert.equal(organizationRoleHasPermission('MANAGER', 'inventory:manage'), true);
  assert.equal(organizationRoleHasPermission('MANAGER', 'availability:manage'), true);
  assert.equal(organizationRoleHasPermission('MANAGER', 'pricing:manage'), true);
  assert.equal(organizationRoleHasPermission('MANAGER', 'booking:manage'), true);
  assert.equal(organizationRoleHasPermission('MANAGER', 'payment:manage'), true);
  assert.equal(organizationRoleHasPermission('MANAGER', 'integration:read'), true);
  assert.equal(organizationRoleHasPermission('MANAGER', 'integration:manage'), false);
  assert.equal(organizationRoleHasPermission('STAFF', 'membership:read'), true);
  assert.equal(organizationRoleHasPermission('STAFF', 'customer:manage'), true);
  assert.equal(organizationRoleHasPermission('STAFF', 'inventory:read'), true);
  assert.equal(organizationRoleHasPermission('STAFF', 'inventory:manage'), false);
  assert.equal(organizationRoleHasPermission('STAFF', 'availability:read'), true);
  assert.equal(organizationRoleHasPermission('STAFF', 'availability:manage'), false);
  assert.equal(organizationRoleHasPermission('STAFF', 'pricing:read'), true);
  assert.equal(organizationRoleHasPermission('STAFF', 'pricing:manage'), false);
  assert.equal(organizationRoleHasPermission('STAFF', 'booking:read'), true);
  assert.equal(organizationRoleHasPermission('STAFF', 'booking:manage'), false);
  assert.equal(organizationRoleHasPermission('STAFF', 'payment:read'), true);
  assert.equal(organizationRoleHasPermission('STAFF', 'payment:manage'), false);
  assert.equal(organizationRoleHasPermission('STAFF', 'integration:read'), false);
  assert.equal(organizationRoleHasPermission('CUSTOMER', 'customer:read'), false);
  assert.equal(organizationRoleHasPermission('CUSTOMER', 'inventory:read'), false);
  assert.equal(organizationRoleHasPermission('CUSTOMER', 'availability:read'), false);
  assert.equal(organizationRoleHasPermission('CUSTOMER', 'pricing:read'), false);
  assert.equal(organizationRoleHasPermission('CUSTOMER', 'booking:read'), false);
  assert.equal(organizationRoleHasPermission('CUSTOMER', 'payment:read'), false);
  assert.equal(organizationRoleHasPermission('CUSTOMER', 'integration:read'), false);
});

test('role parsing accepts only supported organization roles', () => {
  for (const role of ['ADMIN', 'MANAGER', 'STAFF', 'CUSTOMER']) assert.equal(isOrganizationRole(role), true);
  for (const role of ['', 'OWNER', 'admin', 'PLATFORM_ADMIN']) assert.equal(isOrganizationRole(role), false);
});

test('permission lists are stable and least-privilege by default', () => {
  assert.deepEqual(permissionsForOrganizationRole('CUSTOMER'), []);
  assert.deepEqual(permissionsForOrganizationRole('STAFF'), ['membership:read', 'customer:read', 'customer:manage', 'inventory:read', 'availability:read', 'pricing:read', 'booking:read', 'payment:read']);
  assert.equal(organizationRoleHasPermission('MANAGER', 'customer:manage'), true);
  assert.equal(organizationRoleHasPermission('MANAGER', 'integration:manage'), false);
});
