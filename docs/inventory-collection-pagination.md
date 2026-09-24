# Inventory collection pagination boundary

Inventory collection limits are enforced inside server repository and service boundaries, not only by route or query-string parsing. Browser parameters are untrusted input, and internal callers must not be able to request arbitrarily large pages or negative offsets.

## Shared contract

`src/server/inventory/inventory-pagination.ts` is the shared collection boundary for inventory browsing.

- page defaults to `1` unless the requested page is a positive safe integer;
- page size defaults to `20`;
- page size is capped at `50` even for trusted/internal callers;
- the authoritative database count determines `totalPages`;
- out-of-range pages clamp to the final page;
- the helper returns normalized `page`, `pageSize`, `totalPages`, `skip`, and `take` values; and
- impossible negative or unsafe collection totals fail closed.

Collection readers must calculate the tenant/parent-scoped count first, resolve pagination from that count, and use only the resolved `skip` and `take` values in the row query.

## Covered repository-level collections

The shared boundary is used by the currently implemented repository-level collection surfaces for:

- hospitality properties, room types, and rooms;
- hospitality amenity management pages;
- tour products, departures, and add-ons; and
- appointment services, staff, schedules, and staff-service assignments.

These reads keep their existing organization and parent-resource filters and deterministic ordering. Pagination changes do not weaken tenant isolation or turn a collection page into business-decision authority.

## Covered service-level management collections

The same boundary now protects the service-level management collections that previously trusted caller pagination directly:

- hospitality rate plans for one tenant property;
- hospitality rate-plan room-type assignment browsing;
- hospitality restrictions for one tenant property/rate-plan/scope;
- hospitality restriction room-type scope browsing;
- rental overview unit types, operating locations, and physical units;
- rental location physical-unit browsing;
- rental unit-type physical units and pricing periods; and
- rental unit availability-block browsing.

Rental inventory screens contain several independently paginated collections. Each collection resolves and clamps its own page from its authoritative tenant/parent-scoped count. The count and corresponding page rows are read inside a `RepeatableRead` transaction so one management response does not combine a count from one database snapshot with rows from a later snapshot.

## Complete commercial evidence is different

Do not apply management pagination to availability, inventory-protection, pricing, settlement, or other decisions that require complete scoped evidence. Those flows need an explicit bounded-completeness contract and must fail closed when completeness cannot be proven. UI/list pagination is not a substitute for commercial evidence.

This document covers the current inventory browsing boundaries. Additional service-level and future collection boundaries remain subject to the platform-wide pagination invariant and should use a domain-appropriate bounded contract rather than trusting caller-supplied page sizes.
