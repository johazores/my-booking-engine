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

Represents a platform identity record. Authentication credentials and sessions are intentionally not modeled until the authentication slice is implemented.

User email is an identity key, so it must be canonical before persistence: trimmed, lowercase, syntactically valid, and no longer than the schema limit. `src/server/users/user-domain.ts` owns normalization/validation. The PostgreSQL migration `20260830193000_canonical_user_identity` adds database checks so alternate casing or surrounding whitespace cannot bypass the unique email constraint.

User lifecycle transitions are explicit before authentication is added:

- `ACTIVE` → `SUSPENDED` or `ARCHIVED`
- `SUSPENDED` → `ACTIVE` or `ARCHIVED`
- `ARCHIVED` is terminal in the current foundation

Tenant access already requires an `ACTIVE` user, so suspending/archiving an identity removes tenant access even if membership rows remain unchanged.

### OrganizationMembership

Connects users to organizations. The unique `(organizationId, userId)` constraint prevents duplicate membership records. Indexes support tenant and user membership lookups.

Membership lifecycle is explicit and audit-preserving:

- `INVITED` → `ACTIVE` or `ARCHIVED`
- `ACTIVE` → `SUSPENDED` or `ARCHIVED`
- `SUSPENDED` → `ACTIVE` or `ARCHIVED`
- `ARCHIVED` is terminal

Only `ACTIVE` memberships grant tenant access. `ARCHIVED` provides a terminal state for removed/revoked membership history without requiring destructive deletion. The application transition contract lives in `src/server/memberships/membership-domain.ts`, and the tenant scope imports the same active-membership constant so access semantics cannot drift independently.

## Migrations

The initial tenant schema is checked in under `prisma/migrations/20260830043000_initial_tenant_foundation/migration.sql` with a PostgreSQL migration lock file.

The canonical identity migration is checked in under `prisma/migrations/20260830193000_canonical_user_identity/migration.sql`. It intentionally fails if existing user emails are not canonical so operators can review identity collisions instead of silently rewriting commercial identity data.

The membership lifecycle migration is checked in under `prisma/migrations/20260830203000_membership_lifecycle/migration.sql` and adds the terminal `ARCHIVED` membership state.

The migrations have **not** been claimed as applied to a real database from the repository agent environment. They must be applied and verified against an actual PostgreSQL instance before the corresponding checklist item is marked complete.

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

- organization access is restricted to active, non-deleted organizations with an active membership for an active requesting user
- organization, user, and tenant-resource identifiers are validated as UUIDs before Prisma/database access
- organization slug lookups reject non-canonical slugs before querying
- tenant-owned collection queries always include `organizationId`
- tenant-owned single-resource queries always include both `organizationId` and the resource ID
- update/delete repositories must follow the same compound ownership scope rather than looking up a resource globally first

The current organization and organization-membership repositories consume these shared scopes. Future tenant-owned repositories must reuse the same ownership and identifier-validation pattern rather than accepting unrestricted resource IDs from routes or UI input.

Dependency-free scope tests verify that Tenant A and Tenant B produce distinct query scopes even when the same resource ID is supplied, that malformed identifiers fail before a query can be constructed, and that membership lifecycle states cannot accidentally broaden tenant access. Live PostgreSQL integration tests are still required before database-level tenant isolation can be considered fully proven.

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
