# Authorization

SF authorization is server-enforced and organization scoped. Authentication proves user identity; it does not grant tenant access or management authority.

## Roles

Platform roles:

- `USER` — normal authenticated user.
- `ADMIN` — platform administrator. This is a separate global authority and is never inferred from organization membership.

Organization roles:

- `ADMIN` — full organization-management and operational authority.
- `MANAGER` — operational management authority without permission to assign organization roles.
- `STAFF` — customer-management plus read-only operational access to inventory, availability, pricing, bookings, and payments.
- `CUSTOMER` — no internal organization-management, directory, booking-ledger, or payment-ledger capability.

New organization creators receive an `ADMIN` organization membership in the same transaction as organization creation. The authorization migration promotes the earliest active membership in each pre-existing organization to `ADMIN` so existing tenants retain an administrator after the role column is introduced.

## Capabilities

Server code authorizes capabilities rather than scattering role-name checks throughout routes and services. The canonical capability set is:

- `organization:manage`
- `organization-settings:manage`
- `membership:read`
- `membership:manage`
- `membership-role:manage`
- `customer:read`
- `customer:manage`
- `inventory:read`
- `inventory:manage`
- `availability:read`
- `availability:manage`
- `pricing:read`
- `pricing:manage`
- `booking:read`
- `booking:manage`
- `payment:read`
- `payment:manage`

`src/server/authorization/authorization-domain.ts` is the canonical role-to-capability mapping. Protected services call `requireOrganizationPermission` after authenticated user and tenant context are established.

Current role mapping:

| Capability family | ADMIN | MANAGER | STAFF | CUSTOMER |
| --- | --- | --- | --- | --- |
| organization management/settings | manage | none | none | none |
| membership | read/manage/roles | read/manage | read | none |
| customers | read/manage | read/manage | read/manage | none |
| inventory | read/manage | read/manage | read | none |
| availability | read/manage | read/manage | read | none |
| pricing | read/manage | read/manage | read | none |
| bookings | read/manage | read/manage | read | none |
| payments | read/manage | read/manage | read | none |

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

## Operational authorization

Every implemented inventory, availability, pricing, booking, and payment service combines a server-derived active `organizationId` with the resource identifier before it reads or mutates tenant data. Permission checks are independent of tenant ownership checks; knowing another tenant's UUID never grants access.

Read/manage capability pairs intentionally separate operational visibility from mutation authority. `STAFF` can inspect current inventory, availability, pricing, bookings, and payment history but cannot change those domains unless a more specific staff workflow explicitly gains its own capability later.

Payment recording is intentionally more restrictive than customer editing. Only organization `ADMIN` and `MANAGER` roles receive `payment:manage`; `STAFF` receives `payment:read`. The manual/offline payment API derives tenant and actor from authenticated server context, requires same-origin writes, and never accepts an organization ID or authoritative amount from the browser.

`CUSTOMER` organization users intentionally receive no internal directory, booking-ledger, or payment-ledger access. Future customer self-service must introduce ownership-specific read/write rules rather than weakening internal permissions.

## Customer authorization

- `customer:read` protects list, search, detail, and activity history.
- `customer:manage` protects create, edit, and archive.

Customer IDs are always combined with the active `organizationId` when data is loaded or mutated. A user who has customer-management permission in Tenant A cannot use a Tenant B customer UUID to cross the tenant boundary.

## Audit history

Permission-sensitive changes are stored in `audit_events` with organization, actor, action, resource type/id, timestamp, and safe JSON before/after data. Passwords, session tokens, provider credentials, payment-card data, guest PII, and other secrets must never be written to audit data.

Customer updates record changed field names rather than duplicating customer notes/contact values into audit JSON. Booking confirmation records only guest counts, and manual payment audit events record normalized status/amount/provider code without the external manual payment reference.

## Authorization verification

The disposable PostgreSQL verification suite includes authorization and operational integration coverage for organization-role resolution, least privilege, cross-tenant denial, membership lifecycle/role changes, last-active-admin protection, customer operations, inventory/availability/pricing/booking workflows, and payment permission/tenant isolation. The authorization unit suite also locks the canonical role-to-capability mapping, including `payment:read` and `payment:manage`.

These database checks must only be claimed as passed when `npm run test:database` is executed against the guarded disposable PostgreSQL target.
