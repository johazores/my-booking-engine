# Database Design

## Database choice

SF uses PostgreSQL because reservations, payments, availability, memberships, tenant configuration, and audit history benefit from transactions, relational constraints, indexing, and explicit data ownership.

Prisma ORM is the TypeScript data-access layer.

## Implemented models

### Organization

Represents a tenant/business. It includes a stable UUID, canonical unique slug, business kind, lifecycle status, timezone, currency, tenant branding/contact configuration, timestamps, and soft-deletion timestamp.

Organization slugs are normalized to lowercase letters, numbers, and single hyphens. They are limited to 3-63 characters. Application code owns normalization and lifecycle transition rules, while PostgreSQL also adds checks for canonical slug, ISO-style three-letter currency formatting, and non-empty organization names.

Supported lifecycle transitions are intentionally explicit:

- `ACTIVE` → `SUSPENDED` or `ARCHIVED`
- `SUSPENDED` → `ACTIVE` or `ARCHIVED`
- `ARCHIVED` is terminal in the current foundation

White-label presentation is organization-owned. The organization row stores optional logo/favicon URLs, primary/secondary/accent colors, a controlled font choice, business contact values, email sender presentation, public booking copy, and an intended custom domain. Custom domains are globally unique hostnames. Database checks reinforce canonical lowercase colors, supported font values, canonical email fields, and canonical custom-domain storage.

Persisting a custom domain is configuration only; DNS ownership verification and traffic routing are not implied by the model.

### User

Represents a platform identity record. It has canonical email identity, lifecycle status, a platform role, and relationships to password credentials, persisted sessions, memberships, and audit activity.

User email is an identity key, so it must be canonical before persistence: trimmed, lowercase, syntactically valid, and no longer than the schema limit. `src/server/users/user-domain.ts` owns normalization/validation. The PostgreSQL migration `20260830193000_canonical_user_identity` adds database checks so alternate casing or surrounding whitespace cannot bypass the unique email constraint.

User lifecycle transitions are explicit:

- `ACTIVE` → `SUSPENDED` or `ARCHIVED`
- `SUSPENDED` → `ACTIVE` or `ARCHIVED`
- `ARCHIVED` is terminal in the current foundation

Tenant access requires an `ACTIVE` user, so suspending/archiving an identity removes tenant access even if membership rows remain unchanged.

### PasswordCredential and AuthSession

Password credentials are stored separately from user identity rows. Passwords are represented by versioned salted scrypt hashes; plaintext passwords are never persisted.

Authentication sessions store only a SHA-256 digest of the opaque browser token, expiry, revocation state, and user relation. Session tokens themselves are delivered through secure HttpOnly cookies and are not stored in plaintext.

### OrganizationMembership

Connects users to organizations. The unique `(organizationId, userId)` constraint prevents duplicate membership records. Indexes support tenant/user lookups and role/status authorization queries.

Membership lifecycle is explicit and audit-preserving:

- `INVITED` → `ACTIVE` or `ARCHIVED`
- `ACTIVE` → `SUSPENDED` or `ARCHIVED`
- `SUSPENDED` → `ACTIVE` or `ARCHIVED`
- `ARCHIVED` is terminal

Only `ACTIVE` memberships grant tenant access. `ARCHIVED` provides a terminal state for removed/revoked membership history without destructive deletion. The application transition contract lives in `src/server/memberships/membership-domain.ts`, and the tenant scope imports the same active-membership constant so access semantics cannot drift independently.

### AuditEvent

Important tenant administration changes are recorded as organization-owned audit events with the actor, action, resource identity, safe before/after data, and timestamp. Existing uses include organization settings, archival, role/status changes, and white-label branding changes.

Audit records must never contain passwords, session tokens, provider secrets, payment-card data, or other sensitive credentials.

## Migrations

Checked-in migrations include:

- `20260830043000_initial_tenant_foundation`
- `20260830193000_canonical_user_identity`
- `20260830203000_membership_lifecycle`
- `20260830215500_authentication_foundation`
- `20260831032500_authorization-foundation`
- `20260831080000_tenant-branding-settings`

The repository agent has **not** claimed these migrations as applied to a real database. They must be applied and verified against an explicitly disposable PostgreSQL instance before the live PostgreSQL checklist gates are marked complete.

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

The repository also provides `npm run test:database`, which requires a separate `TEST_DATABASE_URL` plus explicit disposable-database confirmation. It validates Prisma, deploys migrations, checks migration status/drift, and runs the checked-in PostgreSQL integration suites. It must never be pointed at the normal application database.

## Tenant ownership rule

Every tenant-owned record must contain an organization identifier or otherwise have an unambiguous relational path to exactly one organization. Tenant security cannot depend on a frontend filter or route parameter alone.

The server-side scope helpers in `src/server/tenancy/tenant-scope.ts` establish the repository contract:

- organization access is restricted to active, non-deleted organizations with an active membership for an active requesting user
- organization, user, and tenant-resource identifiers are validated as UUIDs before Prisma/database access
- organization slug lookups reject non-canonical slugs before querying
- tenant-owned collection queries always include `organizationId`
- tenant-owned single-resource queries always include both `organizationId` and the resource ID
- update/delete repositories follow the same compound ownership scope rather than looking up a resource globally first

Current organization, organization-membership, authorization, organization-management, and branding services follow these ownership rules. Future tenant-owned repositories must reuse the same pattern.

Dependency-free scope tests and checked-in PostgreSQL integration suites cover cross-tenant repository/mutation denial across the implemented foundation. Live PostgreSQL execution remains required before database-level isolation can be considered environment-verified.

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

## State and history

Booking state and payment state must be separate when workflows can diverge. Commercial history should prefer state transitions, audit records, and soft deletion over destructive deletion.

## Concurrency

Availability cannot be implemented as an unsafe read-then-decrement counter. The eventual availability design must support atomic confirmation, capacity/allocations, temporary holds, expiry, restrictions, and overbooking rules where the business permits them.
