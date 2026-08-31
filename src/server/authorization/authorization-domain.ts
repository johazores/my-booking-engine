export type OrganizationRole = 'ADMIN' | 'MANAGER' | 'STAFF' | 'CUSTOMER';

export type OrganizationPermission =
  | 'organization:manage'
  | 'organization-settings:manage'
  | 'membership:read'
  | 'membership:manage'
  | 'membership-role:manage'
  | 'customer:read'
  | 'customer:manage';

const rolePermissions: Record<OrganizationRole, readonly OrganizationPermission[]> = {
  ADMIN: [
    'organization:manage',
    'organization-settings:manage',
    'membership:read',
    'membership:manage',
    'membership-role:manage',
    'customer:read',
    'customer:manage',
  ],
  MANAGER: ['membership:read', 'membership:manage', 'customer:read', 'customer:manage'],
  STAFF: ['membership:read', 'customer:read', 'customer:manage'],
  CUSTOMER: [],
};

export function permissionsForOrganizationRole(role: OrganizationRole) {
  return rolePermissions[role];
}

export function organizationRoleHasPermission(
  role: OrganizationRole,
  permission: OrganizationPermission,
) {
  return rolePermissions[role].includes(permission);
}

export function isOrganizationRole(value: string): value is OrganizationRole {
  return value === 'ADMIN' || value === 'MANAGER' || value === 'STAFF' || value === 'CUSTOMER';
}
