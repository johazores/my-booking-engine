# Database Design

## Database choice

SF uses PostgreSQL because reservations, payments, availability, memberships, tenant configuration, customers, inventory, and audit history benefit from transactions, relational constraints, indexing, and explicit data ownership.

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

Fields include UUID identity, `organizationId`, first/last name, optional canonical email, phone, notes, `ACTIVE` / `ARCHIVED` lifecycle, and lifecycle timestamps.

Customer email is unique per organization through `(organizationId, email)`. PostgreSQL permits multiple `NULL` email values. The database checks canonical email storage, non-blank trimmed names, and archive-state consistency.

Archived customers are preserved rather than deleted so future booking references and history remain valid.

### HospitalityProperty

Represents a tenant-owned hotel/resort property. Property codes are canonical and unique per organization. A property records its own IANA timezone, two-letter country code, optional address data, lifecycle, and timestamps.

PostgreSQL checks canonical codes/country values and archive-state consistency. `(id, organizationId)` is additionally unique so child records can use tenant-consistent composite foreign keys.

### HospitalityRoomType

Represents a sellable room category within one property. It stores name, property-local code, maximum occupancy, optional bed description, lifecycle, and timestamps.

`(propertyId, organizationId)` must reference the same property record/tenant. Room-type codes are unique per property and maximum occupancy is constrained to 1–50 in both application validation and PostgreSQL.

### HospitalityRoom

Represents a physical room within one room type/property hierarchy. Room codes are unique per property. Room status supports `ACTIVE`, `OUT_OF_SERVICE`, and `ARCHIVED`; operational out-of-service transitions remain deferred until availability/operations rules are defined.

The composite `(roomTypeId, propertyId, organizationId)` foreign key prevents a room from being attached to a room type or property belonging to another tenant. PostgreSQL also checks canonical room codes and archive-state consistency.

### HospitalityAmenity and assignments

`HospitalityAmenity` is a reusable tenant-owned definition with canonical tenant-local code, name, lifecycle, timestamps, and `(id, organizationId)` uniqueness for composite references.

`HospitalityPropertyAmenity` and `HospitalityRoomTypeAmenity` are explicit join records. Their composite foreign keys require amenity and parent inventory to share the same organization. Assignment writes are idempotent and repeated assignment does not emit duplicate audit events.

Amenities cannot be archived while assignment rows still exist. Assignment removal is explicit and audited.

### HospitalityPropertyImage and HospitalityRoomTypeImage

Hospitality image records model real media metadata without coupling the inventory domain to a storage provider. Property images carry `(propertyId, organizationId)` and room-type images carry `(roomTypeId, propertyId, organizationId)` through composite foreign keys.

Both image models store a validated HTTPS URL, required alt text, display order, primary-image state, and timestamps. PostgreSQL checks HTTPS storage, non-blank trimmed alt text, and display-order bounds. Application services reject embedded URL credentials and use serializable transactions for primary-image changes.

Images remain readable when parent inventory is archived for historical/configuration visibility, but server mutation services require the property/room type to remain active before set-primary or remove operations.

### HospitalityRatePlan and HospitalityRoomTypeRatePlan

`HospitalityRatePlan` is a property-owned commercial plan identity. It stores `organizationId`, `propertyId`, canonical property-local code, normalized name, optional description, lifecycle, and timestamps.

`HospitalityRoomTypeRatePlan` assigns one rate plan to one room type under the same property. Its two composite foreign keys require the room type and rate plan to share the same `(propertyId, organizationId)`, preventing both cross-tenant and cross-property assignments at the database layer.

Rate-plan assignments are idempotent and audited only when a relationship is actually created. Active room-specific restrictions must be archived before an assignment can be removed. A rate plan cannot be archived until all assignments are removed and all active restrictions are archived.

### HospitalityRestriction

`HospitalityRestriction` is a persisted commercial rule attached to one property rate plan and optionally one room type. It stores an inclusive date window, optional minimum and maximum stay, closed-to-arrival/departure flags, lifecycle, and timestamps.

The rate-plan composite foreign key `(ratePlanId, propertyId, organizationId)` guarantees tenant/property ownership. When `roomTypeId` is present, `(roomTypeId, propertyId, organizationId)` independently guarantees the room type belongs to the same tenant/property. Application services additionally require the room type to have an active assignment to the selected rate plan.

PostgreSQL checks that end date is not before start date, stay values are 1–365 when present, minimum stay does not exceed maximum stay, at least one restriction control is present, and lifecycle/archive timestamps remain consistent. The service rejects overlapping active windows within the same exact rate-plan/room-type scope inside a serializable transaction.

Restriction records are archived instead of edited in place so commercial configuration history remains auditable.

### AuditEvent

Important tenant administration, customer, and inventory lifecycle changes are recorded with organization, actor, action, resource type/id, safe before/after data, and timestamp.

Audit records must never contain passwords, session tokens, provider secrets, payment-card data, or other credentials. Inventory events store only safe identifiers and lifecycle/commercial metadata. Hospitality image events intentionally exclude media URLs.

## Migrations

Checked-in migrations include:

- `20260830043000_initial_tenant_foundation`
- `20260830193000_canonical_user_identity`
- `20260830203000_membership_lifecycle`
- `20260830215500_authentication_foundation`
- `20260831032500_authorization-foundation`
- `20260831080000_tenant-branding-settings`
- `20260831083000_customer-foundation`
- `20260831084500_hospitality-inventory-foundation`
- `20260831092000_hospitality-amenities`
- `20260831094500_hospitality-images`
- `20260831103000_hospitality-rate-plans`
- `20260831113000_hospitality-restrictions`

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

`npm run test:database` requires a separate `TEST_DATABASE_URL` plus explicit disposable-database confirmation. It validates Prisma, deploys migrations, checks migration status/drift, and runs checked-in PostgreSQL integration suites including hospitality restrictions. It must never target the normal application database.

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
- hospitality child records and commercial assignments use composite parent/tenant foreign keys

Customer list/search queries always include organization scope; customer detail/update/archive use `organizationId + customerId`.

Hospitality services likewise scope property, room-type, room, amenity, image, rate-plan, restriction, and assignment reads/writes by organization. Child creation and assignment verify active parent ownership before persistence, while database foreign keys independently prevent cross-tenant relationships.

## Pagination and query safety

Customer and hospitality inventory collections use bounded query patterns where collections can become large:

- page defaults to 1
- page size defaults to 20 and is capped at 50
- out-of-range pages clamp to the final valid page
- customer sort/filter values come from fixed allowlists
- inventory hierarchy queries remain constrained by tenant and parent IDs
- image galleries are capped at 50 records per property or room-type scope
- rate plans, restriction scopes, and restriction history are paginated

Amenity definitions are currently treated as bounded tenant configuration. Pagination must be introduced before expanding that surface into a large catalog.

## Planned domain modeling

Future schemas should model real business relationships rather than mirror UI pages. Expected areas include:

- booking-specific travelers/passengers when required by booking rules
- tours, schedules, capacity
- services, staff, schedules
- rental products and locations
- availability allocations and holds
- pricing/rate values, taxes, and fees
- bookings and booking items
- payments, refunds, reconciliation references
- provider integrations and encrypted credentials

## State and history

Booking state and payment state must remain separate when workflows can diverge. Commercial history should prefer explicit state transitions, audit records, and archival over destructive deletion.

## Concurrency

Availability cannot be implemented as an unsafe read-then-decrement counter. The eventual availability design must support atomic confirmation, allocations/capacity, temporary holds, expiry, effective restrictions, and explicit overbooking rules where applicable.
