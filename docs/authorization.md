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

Role changes are implemented end to end from the authenticated account UI through a same-origin form route into the membership role service. The service validates identifiers and roles, requires `membership-role:manage`, scopes the target to the active tenant, protects the last active administrator, persists the change, and records a safe audit event.

Role mutations use a serializable database transaction because the last-active-admin invariant is organization-wide. Concurrent demotions cannot both observe a stale administrator count and silently remove all active administrators.

## Membership lifecycle management

Authorized administrators and managers can manage membership status according to the canonical lifecycle:

- `INVITED -> ACTIVE | ARCHIVED`
- `ACTIVE -> SUSPENDED | ARCHIVED`
- `SUSPENDED -> ACTIVE | ARCHIVED`
- `ARCHIVED` is terminal

The account UI exposes only valid next states. The server independently validates every transition, requires `membership:manage`, scopes the target membership to the selected organization, prevents suspending or archiving the final active administrator, and writes `membership.status.changed` audit events with safe before/after status data.

Status mutations also use serializable transactions so concurrent administrator deactivations preserve the same last-active-admin invariant as role changes.

The browser never supplies trusted actor identity or organization authority. Actor identity comes from the validated session and organization identity comes from the server-revalidated active tenant context.

## Audit history

Permission-sensitive changes are stored in `audit_events` with organization, actor, action, resource type/id, timestamp, and safe JSON before/after data. Passwords, session tokens, provider credentials, and other secrets must never be written to audit data.

## Authorization verification

The disposable PostgreSQL verification suite includes authorization integration coverage for:

- organization-role resolution and platform-admin authority;
- manager/staff least-privilege enforcement;
- cross-tenant mutation denial;
- role and membership-status mutations;
- terminal archived memberships;
- last-active-admin protection for both role and status changes; and
- audit-event persistence for successful permission-sensitive changes.

These database checks must only be claimed as passed when `npm run test:database` is executed against the guarded disposable PostgreSQL target.

## Next authorization-dependent work

The reusable roles, permissions, role-management, membership-status, audit, and integration-test boundaries are now in place. Organization settings and safe organization deactivation can build on `organization-settings:manage` / `organization:manage` rather than introducing route-local role checks.
