# Authorization

SF authorization is server-enforced and organization scoped. Authentication proves user identity; it does not grant tenant access or management authority.

## Roles

Platform roles:

- `USER` — normal authenticated user.
- `ADMIN` — platform administrator. This is a separate global authority and is never inferred from organization membership.

Organization roles:

- `ADMIN` — full organization-management and operational authority.
- `MANAGER` — operational membership/customer management without authority to assign roles.
- `STAFF` — operational customer management plus read access to organization membership information.
- `CUSTOMER` — no internal organization-management or customer-directory capability.

New organization creators receive an `ADMIN` organization membership in the same transaction as organization creation. The authorization migration promotes the earliest active membership in each pre-existing organization to `ADMIN` so existing tenants retain an administrator after the role column is introduced.

## Capabilities

Server code authorizes capabilities rather than scattering role-name checks throughout routes and services. The current capability set is:

- `organization:manage`
- `organization-settings:manage`
- `membership:read`
- `membership:manage`
- `membership-role:manage`
- `customer:read`
- `customer:manage`

`src/server/authorization/authorization-domain.ts` is the canonical role-to-capability mapping. Protected services call `requireOrganizationPermission` after authenticated user and tenant context are established.

Current role mapping:

| Capability | ADMIN | MANAGER | STAFF | CUSTOMER |
| --- | --- | --- | --- | --- |
| `organization:manage` | yes | no | no | no |
| `organization-settings:manage` | yes | no | no | no |
| `membership:read` | yes | yes | yes | no |
| `membership:manage` | yes | yes | no | no |
| `membership-role:manage` | yes | no | no | no |
| `customer:read` | yes | yes | yes | no |
| `customer:manage` | yes | yes | yes | no |

Platform `ADMIN` authority is evaluated separately and is never represented by an organization role.

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

## Customer authorization

Customer directory access uses capabilities rather than route-local role checks:

- `customer:read` protects list, search, detail, and activity history.
- `customer:manage` protects create, edit, and archive.

Customer IDs are always combined with the active `organizationId` when data is loaded or mutated. A user who has customer-management permission in Tenant A cannot use a Tenant B customer UUID to cross the tenant boundary.

`CUSTOMER` organization users intentionally receive no organization-wide customer-directory access. A future customer self-service portal must introduce a separate ownership/self-access rule rather than weakening this internal permission boundary.

## Audit history

Permission-sensitive changes are stored in `audit_events` with organization, actor, action, resource type/id, timestamp, and safe JSON before/after data. Passwords, session tokens, provider credentials, payment-card data, and other secrets must never be written to audit data.

Customer activity uses the same audit boundary. Customer updates record changed field names rather than duplicating customer notes/contact values into audit JSON.

## Authorization verification

The disposable PostgreSQL verification suite includes authorization and operational integration coverage for:

- organization-role resolution and platform-admin authority;
- manager/staff least-privilege enforcement;
- cross-tenant mutation denial;
- role and membership-status mutations;
- terminal archived memberships;
- last-active-admin protection for both role and status changes;
- customer create/read/update/archive authorization;
- cross-tenant customer ID denial; and
- audit-event persistence for successful permission-sensitive changes.

These database checks must only be claimed as passed when `npm run test:database` is executed against the guarded disposable PostgreSQL target.
