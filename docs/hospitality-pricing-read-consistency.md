# Hospitality pricing read consistency

## Purpose

Pricing management collections are presentation/read-model surfaces. A page count and the rows shown for that page must describe one database state, especially while another manager is creating or archiving pricing configuration.

The following tenant-owned pricing collections now read their authoritative count, clamp the requested page, and read the corresponding rows inside one PostgreSQL `RepeatableRead` transaction:

- active room-type + rate-plan pricing scopes for a property;
- base-rate history for an exact organization/property/room-type/rate-plan scope;
- tax and fee rule history for a property;
- add-on catalog history for a property.

Each service still validates organization, actor, and resource identifiers before database access, requires `pricing:read`, repeats organization and parent-resource scope in the query, uses the existing maximum page size of 50, and preserves deterministic ordering.

## Why the snapshot matters

Without a shared snapshot, a concurrent create/archive can change the collection after `count()` but before `findMany()`. That can produce a total, page number, and returned rows that never existed together. `RepeatableRead` keeps those reads coherent without escalating a read-only management view to a serializable commercial write boundary.

Page clamping happens inside the same transaction after the scoped count is known. A requested page beyond the current end therefore resolves against the same snapshot used to fetch its rows.

## Commercial pricing authority is separate

This read consistency does **not** make management pagination commercial pricing authority. Customer/staff quotes, booking confirmation, revalidation, availability, commercial amendments, accepted pricing evidence, and legal documents continue to use their existing domain-specific complete/transactional evidence boundaries.

A paginated management page never proves that all applicable base rates, charges, add-ons, restrictions, settlement records, or legal-document evidence have been read. Commercial workflows must not reuse these paginated readers as completeness evidence.

## Isolation boundary

The snapshot does not weaken tenant isolation. Every collection remains scoped by `organizationId` and its required property/room-type/rate-plan parent identifiers, and permission checks remain outside and before the database read transaction. The transaction only makes already-authorized tenant-scoped presentation reads internally consistent.

## Validation

`scripts/hospitality-pricing-read-consistency-contract.test.mjs` guards all four management collection boundaries. The source contract requires tenant/parent scope, bounded pagination, deterministic ordering, page clamping inside a `RepeatableRead` transaction, and keeps the documentation boundary between presentation pagination and commercial completeness explicit.
