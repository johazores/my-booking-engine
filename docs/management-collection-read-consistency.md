# Management collection read consistency

SF paginated management collections must return page metadata and rows that describe one database state. A server-side page-size limit alone is not enough when `count()` and `findMany()` run as separate PostgreSQL statements under the default read-committed isolation level.

## Snapshot rule

For bounded management/read-model collections that derive page metadata from a count, the scoped count, page clamping, and row query must execute inside one Prisma interactive transaction using PostgreSQL `RepeatableRead`.

This run applies that rule to:

- user-accessible organization pages;
- tenant membership pages and membership dashboard aggregates;
- customer directory pages;
- hospitality property, room-type, and room inventory pages;
- tour product, departure, and add-on pages;
- appointment service, staff, schedule, and staff-service assignment pages;
- hospitality availability-window management pages.

The existing page-size ceilings, tenant/parent scopes, identifier validation, stable secondary ordering, and permission boundaries remain unchanged.

## Why this matters

A concurrent create, archive, suspension, or reassignment between a count and its page query can otherwise produce a result such as `total=21` with a second page that was calculated from a later 20-row state. The returned metadata and rows would never have existed together.

`RepeatableRead` gives these read-only management views one stable PostgreSQL snapshot without escalating them to the serializable isolation used by commercial writes.

## Tenant and authorization boundaries

Snapshot consistency does not replace authorization or tenant isolation:

- organization access still uses `activeOrganizationMembershipScope`;
- membership pages and aggregates still use `activeTenantOwnedCollectionScope`;
- customer pages remain scoped by `organizationId` plus their requested status/search filters;
- hospitality, tour, appointment, and availability readers repeat organization and required parent-resource identifiers directly in their database predicates;
- permission checks remain in the existing service layer before protected repository reads where applicable.

No cross-tenant broad query is introduced to obtain a total.

## Complete reads and commercial evidence

This rule applies to presentation/read-model collections. It does not convert paginated pages into complete commercial evidence.

Existing bounded complete readers remain intentionally separate where a workflow requires all records, and booking confirmation, pricing revalidation, settlement, availability allocation, legal-document issuance, and other commercial decisions must continue using their domain-specific complete or transactional evidence boundaries.

## Validation contract

`scripts/management-collection-read-consistency-contract.test.mjs` guards the touched collection boundaries. It checks that count and row reads use the transaction client, that each boundary declares `RepeatableRead`, that tenant/parent scoping and deterministic ordering remain present, and that membership aggregates share one snapshot.
