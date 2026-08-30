# Tenant System

## Definition

Every business is an organization/tenant. A tenant may represent a hotel, resort, travel agency, tour operator, appointment business, rental business, marketplace, or another reservation business.

The business kind is descriptive. Product behavior should evolve through capabilities rather than separate duplicated applications.

## Implemented foundation

The current database contains organizations, users, and organization memberships. Server-side repository methods fetch organizations only when the requesting user has an active membership, including lookup by organization ID and canonical slug.

Organization membership reads follow the same server-side boundary. Listing or retrieving a membership requires both the target organization ID and an active membership for the requesting user in that same active, non-deleted organization. A membership ID from another tenant cannot be used by itself to cross the organization boundary.

All tenant-owned read paths that currently exist in the repository now use the shared tenant-scope helpers. There are no tenant-owned write APIs yet; membership mutation is intentionally withheld until roles and permissions exist so an ordinary active member cannot implicitly gain management authority. Future update/delete repositories must bind both `organizationId` and the target resource ID and must additionally validate the required permission before mutation.

Membership lifecycle rules are explicit in `src/server/memberships/membership-domain.ts`:

- `INVITED` → `ACTIVE` or `ARCHIVED`
- `ACTIVE` → `SUSPENDED` or `ARCHIVED`
- `SUSPENDED` → `ACTIVE` or `ARCHIVED`
- `ARCHIVED` is terminal

Only `ACTIVE` memberships grant tenant access. `INVITED`, `SUSPENDED`, and `ARCHIVED` memberships never satisfy the server-side tenant access scope. Archival is the audit-preserving terminal state for a membership that must not be reactivated later.

User identities use canonical trimmed lowercase email values. Their lifecycle is explicit: active identities can be suspended or archived, suspended identities can be reactivated or archived, and archived identities are terminal in the current foundation. Tenant access requires the requesting user itself to remain active, so changing user lifecycle state cannot leave stale access active through an unchanged membership row.

Organization identifiers use stable UUID primary keys plus unique human-readable slugs. Slugs are normalized to lowercase letters, numbers, and single hyphens and are constrained to 3-63 characters.

The initial organization lifecycle is explicit:

- `ACTIVE` can become `SUSPENDED` or `ARCHIVED`
- `SUSPENDED` can return to `ACTIVE` or become `ARCHIVED`
- `ARCHIVED` is terminal in the current foundation

The checked-in PostgreSQL migrations add the tenant tables, relational constraints, indexes, database checks, canonical user identity constraints, and the terminal membership archival state. They still need to be applied and verified against a real PostgreSQL database before live database validation is considered complete.

A reusable server-side tenant scope boundary lives in `src/server/tenancy/tenant-scope.ts`. Organization access scopes require an active membership for the requesting user. Tenant-owned records can additionally use active collection/resource scopes that bind `organizationId` and validate actor access through the owning organization relation. Single-resource lookups bind both the resource identifier and organization identifier so a resource ID from another tenant cannot be used by itself.

The scope helpers are covered by dependency-free tests. Membership lifecycle tests additionally verify that only active memberships grant access and that archived memberships are terminal. The PostgreSQL integration test exercises the real organization and organization-membership repositories in both tenant directions and covers every current repository read path: organization list, ID lookup, canonical-slug lookup, membership list, and membership detail. It also verifies that invited members, suspended users, suspended memberships, archived memberships, and suspended organizations do not satisfy tenant access. These assertions are checked in but remain unverified against live PostgreSQL until `npm run test:database` can run against a disposable database.

This is the beginning of tenant isolation, not a complete authorization system.

## Required security model

Every protected operation must eventually validate:

1. authenticated identity
2. active organization membership
3. required permission/capability
4. scope/ownership of the requested resource

A user from Organization A must never access Organization B data by changing an ID, slug, URL, query string, request body, or API call.

## Tenant repository rule

For every future tenant-owned model:

- collection reads must include `organizationId`
- single-resource reads must include both `organizationId` and resource ID
- updates and deletes must include both `organizationId` and resource ID
- callers must not receive an unrestricted repository method that accepts only a resource ID
- protected operations must validate active membership before using a tenant-owned repository
- write operations must additionally validate the required permission once the authorization model exists

This rule belongs in server/data-access code. Client filtering, hidden navigation, or a route parameter is never an authorization boundary.

## Future tenant-owned areas

- membership role/permission management
- branding/settings
- customers
- inventory/products/properties
- availability/rates
- bookings/payments
- integrations/domains
- email and booking configuration

## White label

Tenant branding is planned after the application shell. Branding should come from tenant configuration/design tokens rather than hardcoded component values and may eventually control business name, logo, favicon, colors, fonts, email branding, booking branding, domain, and contact details.
