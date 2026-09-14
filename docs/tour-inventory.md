# Tour inventory foundation

## Purpose

SF now has a production internal-inventory foundation for tours and packages without forcing tour scheduling into the hospitality property/room schema. This scope establishes tenant-owned product definitions, dated departures, explicit departure capacity, optional add-on definitions, audited lifecycle controls, and authenticated management UI.

It does **not** invent tour pricing, booking allocation, supplier connectivity, passenger rules, or public checkout. Those remain later contracts and must reuse the shared booking/payment/provider foundations only when their real requirements are known.

## Data model

The Prisma schema lives in `prisma/tour-inventory.prisma` and is backed by migration `20260914122000_tour_inventory_foundation`.

- `TourProduct` represents either a `TOUR` or `PACKAGE`, with tenant-local code, IANA timezone, optional meeting point/description, and active/archive lifecycle.
- `TourDeparture` belongs to exactly one product in the same tenant, stores exact offset-derived `startsAt`/`endsAt` instants, and carries configured sellable capacity from 1 to 10,000.
- `TourAddon` belongs to exactly one product in the same tenant and defines an optional component plus a bounded per-booking quantity. It intentionally contains no invented price.

The database enforces organization ownership for products and composite `(tourProductId, organizationId)` ownership for departures/add-ons. Product code is unique per tenant; departure start is unique per product; add-on code is unique per product. Database checks mirror application bounds for time order, maximum duration, capacity, add-on quantity, and archive timestamps.

## Authorization and tenant isolation

Reads require `inventory:read`; writes and archives require `inventory:manage`. The active organization is resolved server-side from the authenticated session. Browser-provided route IDs are only resource selectors and are always combined with the active `organizationId` before reads or mutations.

All writes are serializable transactions and emit existing tenant audit events. Cross-tenant product/departure/add-on relationships are rejected by composite database foreign keys, and service queries independently scope every record to the active tenant.

## Schedule time contract

Departure create requires RFC 3339 timestamps with an explicit `Z` or numeric UTC offset. SF does not reinterpret a browser-local wall-clock string as a supplier or tenant instant. The product IANA timezone is retained for presentation; stored schedule authority is the exact PostgreSQL timestamptz instant.

A departure end must be after start and no more than 31 days later. Capacity is configured inventory only; current hospitality holds/allocations are not reused or faked for tours.

## Lifecycle

Archival is explicit and requires typing `ARCHIVE`. Departure and add-on records are archived rather than deleted. A tour/package cannot be archived while active departures or add-ons remain, keeping lifecycle dependencies visible and preserving historical inventory evidence.

No delete endpoint exists for this scope.

## UI

Authenticated operators use:

- `/inventory/tours` for paginated tour/package catalog and product creation;
- `/inventory/tours/[tour-id]` for schedules, capacity, add-ons, and archival controls.

The pages reuse SF native CSS/design-token components and existing inventory authorization. Empty, permission-denied, validation, conflict, dependency, success, loading, error, and archived states are explicit. No dead booking or pricing action is exposed.

## Validation and remaining work

Dependency-free domain coverage validates product normalization, exact-offset schedules, capacity bounds, add-on bounds, and archive confirmation. A source-contract suite covers tenant/database relationships, permission guards, serializable/audited writes, real route wiring, and the no-fake-pricing boundary. A guarded PostgreSQL integration scenario is included in `npm run test:database` for permission, Tenant A/Tenant B isolation, uniqueness, dependency-safe archival, and audit behavior.

The current automation environment still cannot claim Prisma generate/validate/migration execution or PostgreSQL integration because the repository-supported Node 24 dependency checkout and an explicitly disposable database target are unavailable. Those remain governed by the Phase 1 validation gates.

Tour pricing, availability/hold allocation, passenger/traveler rules, booking state, public booking UX, refunds, and supplier adapters remain later tour-operator workflow work rather than implicit behavior of this inventory foundation.
