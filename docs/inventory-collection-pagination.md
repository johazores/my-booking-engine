# Inventory collection pagination boundary

Inventory collection limits are enforced inside server repository boundaries, not only by route or query-string parsing. Browser parameters are untrusted input, and internal callers must not be able to request arbitrarily large pages or negative offsets.

## Shared contract

`src/server/inventory/inventory-pagination.ts` is the shared collection boundary for inventory repositories.

- page defaults to `1` unless the requested page is a positive safe integer;
- page size defaults to `20`;
- page size is capped at `50` even for trusted/internal callers;
- the authoritative database count determines `totalPages`;
- out-of-range pages clamp to the final page;
- the helper returns normalized `page`, `pageSize`, `totalPages`, `skip`, and `take` values; and
- impossible negative or unsafe collection totals fail closed.

Collection repositories must calculate the tenant/parent-scoped count first, resolve pagination from that count, and use only the resolved `skip` and `take` values in the row query.

## Covered inventory repositories

The shared boundary is used by the currently implemented repository-level collection surfaces for:

- hospitality properties, room types, and rooms;
- hospitality amenity management pages;
- tour products, departures, and add-ons; and
- appointment services, staff, schedules, and staff-service assignments.

These reads keep their existing organization and parent-resource filters and deterministic ordering. Pagination changes do not weaken tenant isolation or turn a collection page into business-decision authority.

## Complete commercial evidence is different

Do not apply management pagination to availability, inventory-protection, pricing, settlement, or other decisions that require complete scoped evidence. Those flows need an explicit bounded-completeness contract and must fail closed when completeness cannot be proven. UI/list pagination is not a substitute for commercial evidence.

This document covers repository-level inventory collection browsing. Additional service-level and future collection boundaries remain subject to the platform-wide pagination invariant and should use a domain-appropriate bounded contract rather than trusting caller-supplied page sizes.
