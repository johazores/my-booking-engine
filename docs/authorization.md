# Authorization

SF authorization is server-enforced and organization scoped. Authentication proves user identity; it does not grant tenant access or management authority.

## Roles

Platform roles:

- `USER` — normal authenticated user.
- `ADMIN` — platform administrator. This is a separate global authority and is never inferred from organization membership.

Organization roles:

- `ADMIN` — full organization-management authority.
- `MANAGER` — operational membership management without authority to assign roles.
- `STAFF` — read access to organization membership information needed for operations.
- `CUSTOMER` — no internal organization-management capability.

New organization creators receive an `ADMIN` organization membership in the same transaction as organization creation. The authorization migration promotes the earliest active membership in each pre-existing organization to `ADMIN` so existing tenants retain an administrator after the new role column is introduced.

## Capabilities

Server code authorizes capabilities rather than scattering role-name checks throughout routes and services. The current capability set is:

- `organization:manage`
- `organization-settings:manage`
- `membership:read`
- `membership:manage`
- `membership-role:manage`

`src/server/authorization/authorization-domain.ts` is the canonical role-to-capability mapping. Protected services call `requireOrganizationPermission` after authenticated user and tenant context are established.

## Membership role changes

Role changes are implemented end to end from the authenticated account UI through a same-origin form route into the membership role service. The service:

1. validates user, organization, membership and role identifiers;
2. requires `membership-role:manage` server-side;
3. scopes the target membership to the active organization;
4. refuses to demote the last active organization administrator;
5. persists the role change transactionally; and
6. writes an audit event containing only safe before/after role data.

The browser never supplies trusted actor identity or organization authority. Actor identity comes from the validated session and organization identity comes from the server-revalidated active tenant context.

## Audit history

Permission-sensitive changes are stored in `audit_events` with organization, actor, action, resource type/id, timestamp, and safe JSON before/after data. Passwords, session tokens, provider credentials, and other secrets must never be written to audit data.

## Next authorization work

The current slice establishes the reusable authorization boundary and role-management workflow. Membership invitations/status management and organization settings/deactivation should build on this boundary rather than adding route-local role checks.
