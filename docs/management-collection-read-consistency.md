# Management collection read consistency

SF paginated management collections must return page metadata and rows that describe one database state. A server-side page-size limit alone is not enough when `count()` and `findMany()` run as separate PostgreSQL statements under the default read-committed isolation level.

## Snapshot rule

For bounded management/read-model collections that derive page metadata from a count, the scoped count, page clamping, and row query must execute inside one Prisma interactive transaction using PostgreSQL `RepeatableRead`.

The current implementation applies that rule to:

- user-accessible organization pages;
- tenant membership pages and membership dashboard aggregates;
- customer directory pages;
- hospitality property, room-type, room, amenity, rate-plan, rate-plan room-type, restriction, and restriction-scope pages;
- tour product, departure, and add-on pages;
- appointment service, staff, schedule, and staff-service assignment pages;
- hospitality availability-window management pages;
- rental inventory collection pages and rental maintenance work-order pages; and
- integration control-plane reads that combine provider records with current connection-health evidence.

The existing page-size ceilings, tenant/parent scopes, identifier validation, stable secondary ordering, and permission boundaries remain unchanged.

## Why this matters

A concurrent create, archive, suspension, credential rotation, provider health test, or reassignment between related statements can otherwise produce a result such as `total=21` with a second page calculated from a later 20-row state, or an integration record from one credential version paired with health evidence observed after a rotation. Those returned values would never have existed together.

`RepeatableRead` gives these read-only management views one stable PostgreSQL snapshot without escalating them to the serializable isolation used by commercial writes.

## Tenant and authorization boundaries

Snapshot consistency does not replace authorization or tenant isolation:

- organization access still uses `activeOrganizationMembershipScope`;
- membership pages and aggregates still use `activeTenantOwnedCollectionScope`;
- customer pages remain scoped by `organizationId` plus their requested status/search filters;
- hospitality, tour, appointment, rental, and availability readers repeat organization and required parent-resource identifiers directly in their database predicates;
- integration records and their health audit evidence remain organization scoped, with `integration:read` checked before protected reads; and
- permission checks remain in the existing service layer before protected repository reads where applicable.

No cross-tenant broad query is introduced to obtain a total or related read-model evidence.

## Parent authority in the same snapshot

When a collection only exists beneath a tenant-owned parent, the parent check belongs to the same snapshot as the count and rows when practical. Hospitality rate-plan room-type browsing and restriction management therefore verify the scoped rate plan through the same `RepeatableRead` transaction that produces the page.

Rental maintenance verifies the active tenant-owned unit before counting or listing work orders in the same snapshot. Its page is also clamped after the authoritative count rather than returning a requested page that no longer exists after concurrent maintenance history changes.

## Integration health consistency

Integration health is presentation evidence derived from `integration.connection-tested` audit events. Exact provider reads, paginated provider directories, and the bounded legacy complete reader load the integration row and matching health evidence from one `RepeatableRead` snapshot. This keeps credential-version and lifecycle checks meaningful if a connection test, credential rotation, disable, or archive happens concurrently.

This snapshot rule does not grant provider runtime authority. Runtime credential loading and provider operations retain their existing provider-specific capability, lifecycle, and adapter boundaries.

## Complete reads and commercial evidence

This rule applies to presentation/read-model collections. It does not convert paginated pages into complete commercial evidence.

Existing bounded complete readers remain intentionally separate where a workflow requires all records, and booking confirmation, pricing revalidation, settlement, availability allocation, legal-document issuance, and other commercial decisions must continue using their domain-specific complete or transactional evidence boundaries.

## Validation contract

`scripts/management-collection-read-consistency-contract.test.mjs` guards the original collection boundaries. `scripts/remaining-management-read-consistency-contract.test.mjs` covers the follow-up hospitality inventory, rental maintenance, and integration control-plane surfaces. Together they check that count/row reads use the transaction client, that each boundary declares `RepeatableRead`, that tenant/parent scoping and deterministic ordering remain present, and that related evidence is observed from the same snapshot.
