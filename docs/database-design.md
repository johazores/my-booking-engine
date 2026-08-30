# Database Design

## Database choice

SF uses PostgreSQL because reservations, payments, availability, memberships, and audit history benefit from transactions, relational constraints, indexing, and explicit data ownership.

Prisma ORM is the TypeScript data-access layer.

## Implemented models

### Organization

Represents a tenant/business. It includes a stable UUID, canonical unique slug, business kind, lifecycle status, timezone, currency, timestamps, and soft-deletion timestamp.

Organization slugs are normalized to lowercase letters, numbers, and single hyphens. They are limited to 3-63 characters. Application code owns normalization and lifecycle transition rules, while the initial PostgreSQL migration also adds database checks for canonical slug, ISO-style three-letter currency formatting, and non-empty organization names.

Supported lifecycle transitions are intentionally explicit:

- `ACTIVE` → `SUSPENDED` or `ARCHIVED`
- `SUSPENDED` → `ACTIVE` or `ARCHIVED`
- `ARCHIVED` is terminal in the current foundation

### User

Represents a platform identity record. Authentication details are intentionally not modeled until the authentication slice is implemented.

### OrganizationMembership

Connects users to organizations. The unique `(organizationId, userId)` constraint prevents duplicate membership records. Indexes support tenant and user membership lookups.

## Initial migration

The initial tenant schema is checked in under `prisma/migrations/20260830043000_initial_tenant_foundation/migration.sql` with a PostgreSQL migration lock file.

The migration has **not** been claimed as applied to a real database from the repository agent environment. It must be applied and verified against an actual PostgreSQL instance before the corresponding checklist item is marked complete.

For a local database:

```bash
cp .env.example .env.local
# set DATABASE_URL to an empty PostgreSQL database
npm install
npm run prisma:generate
npm run prisma:validate
npm run db:deploy
```

For development environments where migrations are being authored rather than only deployed, use `npm run db:migrate` against an isolated development database.

## Tenant ownership rule

Future tenant-owned records must contain an organization identifier or otherwise have an unambiguous relational path to exactly one organization. Tenant security cannot depend on a frontend filter or route parameter alone.

The server-side scope helpers in `src/server/tenancy/tenant-scope.ts` establish the repository contract:

- organization access is restricted to active, non-deleted organizations with an active membership for the requesting user
- tenant-owned collection queries always include `organizationId`
- tenant-owned single-resource queries always include both `organizationId` and the resource ID
- update/delete repositories must follow the same compound ownership scope rather than looking up a resource globally first

The current organization repository consumes these shared scopes. Future tenant-owned repositories must reuse the same ownership pattern rather than accepting unrestricted resource IDs from routes or UI input.

Dependency-free scope tests verify that Tenant A and Tenant B produce distinct query scopes even when the same resource ID is supplied. Live PostgreSQL integration tests are still required before database-level tenant isolation can be considered fully proven.

## Planned domain modeling

Future schemas should model real business relationships rather than mirror UI pages. Important expected areas include:

- customers/travelers/guests
- properties, room types, rooms, rates, restrictions
- tours, schedules, capacity
- services, staff, schedules
- rental products and locations
- availability allocations and holds
- bookings and booking items
- payments, refunds, reconciliation references
- provider integrations and encrypted credentials
- audit records

## State and history

Booking state and payment state must be separate when workflows can diverge. Commercial history should prefer state transitions, audit records, and soft deletion over destructive deletion.

## Concurrency

Availability cannot be implemented as an unsafe read-then-decrement counter. The eventual availability design must support atomic confirmation, capacity/allocations, temporary holds, expiry, restrictions, and overbooking rules where the business permits them.
