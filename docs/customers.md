# Customers

## Status

The tenant-scoped customer directory is implemented as SF's first operational booking-domain module. It provides real persisted customer/traveler/guest records for the active organization and reuses the existing session, tenant, authorization, audit, and application-shell boundaries.

## Data model

`Customer` belongs directly to one `Organization` and stores:

- UUID identity
- first and last name
- optional canonical email
- optional phone
- optional internal notes
- lifecycle status (`ACTIVE` or `ARCHIVED`)
- created/updated timestamps
- archive timestamp

Customer email is unique **within an organization**, not globally. Multiple tenants can therefore have the same real-world customer email without sharing customer records. Empty email values remain `NULL` so customers without email can coexist safely.

The database enforces tenant ownership, canonical email storage, non-blank trimmed names, archive-state consistency, tenant-local email uniqueness, and indexes for lifecycle/date and name lookups.

## Authorization

The customer capability set is:

- `customer:read`
- `customer:manage`

Organization roles currently resolve these capabilities as follows:

| Role | Read customers | Manage customers |
| --- | --- | --- |
| ADMIN | yes | yes |
| MANAGER | yes | yes |
| STAFF | yes | yes |
| CUSTOMER | no | no |

Platform administrators retain their existing global active-organization authority.

Every list, detail, create, update, and archive operation revalidates organization authorization server-side. A customer ID never grants access by itself: single-resource reads and writes include both `organizationId` and `customerId` at the repository/service boundary.

## Customer directory

`/customers` is part of the canonical authenticated workspace and supports:

- tenant-aware customer count
- search by name, email, or phone
- active/archived/all lifecycle filter
- newest/oldest/name sorting
- bounded 20/50-result pagination
- automatic clamping of out-of-range page requests
- empty and no-match states
- create form for authorized staff
- read-only access for roles that have `customer:read` without `customer:manage`
- responsive desktop/tablet/mobile layouts

Search strings, page numbers, page size, sort, and status are parsed through the customer domain before building Prisma queries. Page size is capped at 50.

## Create and update

Customer writes use same-origin authenticated form routes. Actor identity comes from the validated session and organization identity comes from the server-revalidated active tenant context.

The domain normalizes:

- names to trimmed single-spaced values
- customer email to canonical lowercase form
- phone whitespace/allowed characters
- notes to trimmed bounded text

Duplicate canonical email inside the same organization produces a controlled conflict instead of leaking a database exception.

Customer updates are limited to active records. No-op updates do not create artificial audit history.

## Archive lifecycle

Customers are archived rather than deleted. Archival:

1. requires `customer:manage`
2. requires the explicit text confirmation `ARCHIVE`
3. scopes the target to the active organization
4. changes `status` to `ARCHIVED`
5. records `archivedAt`
6. writes a `customer.archived` audit event
7. leaves the record readable for history and future booking references

Archived records are read-only in the current lifecycle.

## Activity history

Customer create/update/archive operations write audit events using `resourceType = customer` and the customer UUID. The detail page shows the action, authenticated actor, and timestamp.

To minimize unnecessary personal-data duplication, update audit events record which fields changed rather than copying customer notes or contact values into audit JSON.

## Security notes

Internal notes are not a secret store. UI guidance explicitly warns against storing passwords, payment-card data, provider secrets, or other credentials in customer notes.

Cross-tenant behavior is fail-closed: an authorized Tenant A user querying or mutating a Tenant B customer ID receives no Tenant B customer record.

## Verification

Dependency-free tests cover customer normalization, validation, lifecycle confirmation, and bounded list-query parsing. Authorization-domain tests cover customer capability mapping and least privilege.

The disposable PostgreSQL suite includes customer integration coverage for:

- unauthorized outsider denial
- staff create/manage authority
- tenant-local duplicate email rules
- Tenant A/Tenant B listing isolation
- cross-tenant ID read/mutation denial
- update audit history
- customer archival
- archived-record immutability

Live database execution must only be claimed after `npm run test:database` runs against an explicitly confirmed disposable PostgreSQL target. GitHub Actions are not used.
