# Tenant System

## Definition

Every business is an organization/tenant. A tenant may represent a hotel, resort, travel agency, tour operator, appointment business, rental business, marketplace, or another reservation business.

The business kind is descriptive. Product behavior evolves through capabilities rather than duplicated applications.

## Implemented foundation

The current database contains organizations, users, organization memberships, customers, internal inventory, availability/pricing/booking/payment records, tenant integrations, and audit history. Implemented protected server operations resolve the authenticated user and active tenant before accessing tenant-owned data, then apply the relevant capability check for the requested operation.

Organization membership reads follow the same server-side boundary. Listing or retrieving a membership requires both the target organization ID and active access for the requesting user in that same active, non-deleted organization. A membership ID from another tenant cannot be used by itself to cross the organization boundary.

Tenant-owned child-resource reads bind `organizationId` plus the resource identifier. Mutable production services also retain write-time ownership at the final persistence boundary instead of relying only on a preceding scoped read. Customer, membership, branding, organization-management, internal inventory, availability, pricing, booking, payment, and integration code apply the tenant boundary according to their domain-specific lifecycle and commercial rules. Provider-specific behavior remains behind adapters.

For tenant-owned child rows, final mutations repeat `organizationId` and the relevant resource/lifecycle scope when the model supports it. The `Organization` row is the tenant root and therefore has no separate tenant foreign key; root settings, branding, and archive mutations pin the exact server-authorized organization ID and the expected active/non-deleted lifecycle state. See `docs/core-tenant-write-scope.md` for the core administration/customer write contract and the domain-specific write-scope documents for inventory/hospitality boundaries.

Membership lifecycle rules are explicit in `src/server/memberships/membership-domain.ts`:

- `INVITED` → `ACTIVE` or `ARCHIVED`
- `ACTIVE` → `SUSPENDED` or `ARCHIVED`
- `SUSPENDED` → `ACTIVE` or `ARCHIVED`
- `ARCHIVED` is terminal

Only `ACTIVE` memberships grant tenant access. `INVITED`, `SUSPENDED`, and `ARCHIVED` memberships never satisfy the server-side tenant access scope. Archival is the audit-preserving terminal state for a membership that must not be reactivated later.

User identities use canonical trimmed lowercase email values. Their lifecycle is explicit: active identities can be suspended or archived, suspended identities can be reactivated or archived, and archived identities are terminal in the current foundation. Tenant access requires the requesting user itself to remain active, so changing user lifecycle state cannot leave stale access active through an unchanged membership row.

Organization identifiers use stable UUID primary keys plus unique human-readable slugs. Slugs are normalized to lowercase letters, numbers, and single hyphens and are constrained to 3-63 characters.

The organization lifecycle is explicit:

- `ACTIVE` can become `SUSPENDED` or `ARCHIVED`
- `SUSPENDED` can return to `ACTIVE` or become `ARCHIVED`
- `ARCHIVED` is terminal in the current foundation

The checked-in PostgreSQL migrations define the tenant tables, relational constraints, indexes, database checks, canonical identity rules, authorization relations, tenant-owned business models, and lifecycle constraints. The complete chain still needs to be applied and verified against an explicitly disposable PostgreSQL database before the two open Phase 1 live-database gates can be claimed complete.

A reusable server-side tenant scope boundary lives in `src/server/tenancy/tenant-scope.ts`. Organization access scopes require an active user, active organization, and active membership. Tenant-owned repositories/services add resource ownership and permission checks appropriate to each domain. Single-resource lookups bind both the resource identifier and organization identifier so a resource ID from another tenant cannot be used by itself.

Dependency-free tests cover tenant-scope and lifecycle rules, while the guarded PostgreSQL integration suite exercises real Tenant A/Tenant B isolation and protected workflows. Checked-in database scenarios are not claimed as executed until `npm run test:database` runs successfully against an explicitly acknowledged disposable PostgreSQL target.

## Required security model

Every protected operation validates, as applicable:

1. authenticated identity
2. active organization membership or platform-admin authority
3. required permission/capability
4. scope/ownership of the requested resource
5. lifecycle/commercial preconditions for the final write

A user from Organization A must never access or mutate Organization B data by changing an ID, slug, URL, query string, request body, browser cookie, or API call.

## Tenant repository and service rule

For every tenant-owned model:

- collection reads include `organizationId`
- single-resource reads include both `organizationId` and resource ID
- updates and deletes retain both `organizationId` and resource identity at the final persistence boundary where the model supports an organization foreign key
- lifecycle-sensitive writes retain the expected state when that state is part of the validated precondition
- organization-root writes bind the exact authorized organization ID and expected lifecycle because the tenant root cannot contain a second organization key
- callers do not receive unrestricted production mutation methods that accept only a tenant-owned resource ID
- protected operations validate active tenant access before using tenant-owned repositories/services
- write operations validate the required capability independently of ownership
- external/commercial writes additionally preserve their provider, idempotency, locking, reconciliation, and state-machine contracts

This rule belongs in server/data-access code. Client filtering, hidden navigation, route parameters, or cookies are never authorization boundaries.

## Current tenant-owned product areas

The tenant boundary is currently used by implemented organization/membership administration, branding/settings, customers, hospitality inventory, tour inventory, appointment inventory, rental inventory and rental holds, hospitality availability/pricing/bookings, payments/legal-document foundations, and integration/provider management.

New domain models must follow the same tenant isolation rule before their UI or API is considered production-ready. Advanced tour, appointment, rental, marketplace, and additional-provider workflows remain separate roadmap work and must not weaken the shared tenant boundary.

## White label

Tenant branding is implemented for the authenticated workspace and public hospitality booking journey. Branding comes from persisted tenant configuration/design tokens rather than tenant-specific component copies. Current settings include business identity, logo/favicon, controlled colors/fonts, public booking copy, contact/email-branding values, and intended custom domain configuration.

Custom-domain persistence does not claim DNS ownership verification or custom-host routing. Those infrastructure capabilities remain separate from the tenant data model.
