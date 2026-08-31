# Database Design

## Database choice

SF uses PostgreSQL because reservations, payments, availability, memberships, tenant configuration, customers, and audit history benefit from transactions, relational constraints, indexing, and explicit data ownership.

Prisma ORM is the TypeScript data-access layer.

## Implemented models

### Organization

Represents a tenant/business. It includes a stable UUID, canonical unique slug, business kind, lifecycle status, timezone, currency, tenant branding/contact configuration, timestamps, and soft-deletion timestamp.

Organization slugs are normalized to lowercase letters, numbers, and single hyphens. Application code owns lifecycle transitions while PostgreSQL reinforces canonical slugs, ISO-style currency formatting, non-empty names, branding/color/domain rules, and custom-domain uniqueness.

Supported lifecycle transitions:

- `ACTIVE` → `SUSPENDED` or `ARCHIVED`
- `SUSPENDED` → `ACTIVE` or `ARCHIVED`
- `ARCHIVED` is terminal

### User

Represents a platform identity record with canonical email, lifecycle status, platform role, password credential, sessions, memberships, and audit relations.

User email is trimmed, lowercase, syntactically validated, and bounded to the schema limit before persistence. Database checks prevent casing/whitespace variants from bypassing the unique identity constraint.

### PasswordCredential and AuthSession

Password credentials are stored separately from user identity. Passwords use versioned salted scrypt hashes; plaintext passwords are never persisted.

Authentication sessions store only the SHA-256 digest of the opaque browser token plus expiry/revocation state and user identity. Browser tokens are delivered through secure HttpOnly cookies.

### OrganizationMembership

Connects users to organizations. The unique `(organizationId, userId)` constraint prevents duplicate membership records. Indexes support tenant/user and role/status authorization lookups.

Membership lifecycle:

- `INVITED` → `ACTIVE` or `ARCHIVED`
- `ACTIVE` → `SUSPENDED` or `ARCHIVED`
- `SUSPENDED` → `ACTIVE` or `ARCHIVED`
- `ARCHIVED` is terminal

Only active memberships grant tenant access.

### Customer

Represents tenant-owned customer/contact identity for operational booking workflows.

Fields include:

- UUID identity
- `organizationId`
- first/last name
- optional canonical email
- optional phone
- optional internal notes
- `ACTIVE` / `ARCHIVED` lifecycle
- created/updated/archive timestamps

Customer email is unique per organization through `(organizationId, email)`. PostgreSQL permits multiple `NULL` email values, so customers without email are not artificially blocked. The database also checks canonical email storage, non-blank trimmed names, and archive-state consistency.

Indexes support tenant lifecycle/date queries and tenant/name ordering. Every customer read/write also carries organization scope in application data access; a customer UUID is never sufficient authorization by itself.

Archived customers are preserved rather than deleted so future booking references and history remain valid.

### AuditEvent

Important tenant administration and customer lifecycle changes are recorded with organization, actor, action, resource type/id, safe before/after data, and timestamp.

Audit records must never contain passwords, session tokens, provider secrets, payment-card data, or other credentials. Customer updates record changed field names instead of copying internal notes/contact values into audit JSON.

## Migrations

Checked-in migrations include:

- `20260830043000_initial_tenant_foundation`
- `20260830193000_canonical_user_identity`
- `20260830203000_membership_lifecycle`
- `20260830215500_authentication_foundation`
- `20260831032500_authorization-foundation`
- `20260831080000_tenant-branding-settings`
- `20260831083000_customer-foundation`

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

For migration authoring, use `npm run db:migrate` only against an isolated development database.

`npm run test:database` requires a separate `TEST_DATABASE_URL` plus explicit disposable-database confirmation. It validates Prisma, deploys migrations, checks migration status/drift, and runs checked-in PostgreSQL integration suites. It must never target the normal application database.

## Tenant ownership rule

Every tenant-owned record must contain an organization identifier or have an unambiguous relational path to exactly one organization. Tenant security cannot depend on frontend filters, route parameters, or cookies alone.

Current repository/service rules:

- active organization access requires an active user and active membership
- UUID identifiers are validated before database access
- organization slug lookups require canonical slugs
- tenant-owned collections include `organizationId`
- tenant-owned resources include both `organizationId` and resource ID
- writes use the same ownership scope rather than globally loading by resource ID first
- protected services require explicit capability checks before accessing tenant-owned data

The customer repository follows this contract directly. Customer list/search queries always include organization scope; customer detail/update/archive use `organizationId + customerId`.

## Pagination and query safety

Customer directory pagination is the first large-collection implementation and establishes the bounded query pattern:

- page defaults to 1
- page size defaults to 20 and is capped at 50
- out-of-range pages clamp to the final valid page
- sort values come from a fixed allowlist
- lifecycle filter values come from a fixed allowlist
- search input is normalized and bounded before Prisma query construction

Future large tenant collections should follow the same bounded-query approach.

## Planned domain modeling

Future schemas should model real business relationships rather than mirror UI pages. Expected areas include:

- booking-specific travelers/passengers when required by booking rules
- properties, room types, rooms, rates, restrictions
- tours, schedules, capacity
- services, staff, schedules
- rental products and locations
- availability allocations and holds
- bookings and booking items
- payments, refunds, reconciliation references
- provider integrations and encrypted credentials

## State and history

Booking state and payment state must remain separate when workflows can diverge. Commercial history should prefer explicit state transitions, audit records, and archival over destructive deletion.

## Concurrency

Availability cannot be implemented as an unsafe read-then-decrement counter. The eventual availability design must support atomic confirmation, allocations/capacity, temporary holds, expiry, restrictions, and explicit overbooking rules where applicable.
