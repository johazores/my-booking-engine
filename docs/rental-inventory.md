# Rental inventory

SF rental inventory is a tenant-owned production foundation for rentable physical inventory. It intentionally separates catalog, operating-location, availability-calendar, and rate configuration from later booking, hold, payment, and supplier integrations.

## Implemented scope

- Rental unit types with tenant-local codes, currency, and a required default daily price in minor units.
- Tenant-owned operating/home locations with tenant-local codes, postal address fields, ISO-style two-letter country code, IANA timezone, and active/archive lifecycle.
- Individually managed rental units linked to both a unit type and, for all newly created units, an active tenant location. Existing pre-location rows may remain temporarily unassigned after migration and can be assigned from the unit detail screen.
- Audited unit relocation between active locations. Reassigning a unit to its current location is idempotent.
- Unit-level availability blocks using half-open calendar ranges `[startsOn, endsOn)`.
- Unit-type date-range daily price overrides. Overlapping active pricing periods for a unit type are rejected.
- Overlapping availability blocks for a unit are rejected.
- Server-side `inventory:read` / `inventory:manage` authorization.
- Tenant-scoped reads and mutations; resource identifiers and submitted location codes are never sufficient without the authenticated `organizationId`.
- Database-enforced tenant roots: root rental unit types and locations have PostgreSQL foreign keys to their owning organization, while child unit/block/rate relations remain organization-composite.
- Archive lifecycle for commercial unit type, unit, and location rows. Unit types cannot be archived while active units remain. Locations cannot be archived while active units are assigned. Archiving a unit retains historical availability blocks and its last location reference.
- Database lifecycle invariants: status/archive timestamp consistency is also enforced with database checks for unit types, physical units, and locations.
- Explicit `ARCHIVE` and `REMOVE` confirmations for destructive management operations.
- Audit events for location, unit type, unit, relocation, block, and rate mutations.
- Independently bounded pagination for unit types, locations, units, availability blocks, and rate periods.
- Real management UI under `/inventory/rentals`, with dedicated unit-type, location, and unit detail pages.

## Location semantics

A rental location is inventory metadata representing the current operating/home location of physical stock. It is tenant-owned and can be used to organize units without inventing a customer booking journey.

Location codes are canonical tenant-local identifiers. Unit creation resolves the submitted location code server-side against the active organization, and unit relocation repeats that tenant-scoped lookup before persistence. A location cannot be archived while any active unit still references it. Historical archived units may retain the location relationship so previous inventory state is not erased.

This model does **not** make a location a customer-selected pickup or drop-off promise. Pickup/drop-off eligibility, one-way returns, delivery zones, transfer fees, opening hours, location-specific taxes, and booking allocation require separate rental workflow acceptance criteria.

## Date and pricing semantics

Calendar records are date-only PostgreSQL `DATE` values. The end date is exclusive. For example, a block from `2026-10-01` through `2026-10-04` makes October 1, 2, and 3 unavailable.

Pricing is stored only as integer minor units. A unit type owns its currency; rate periods override the daily amount for a date range but never introduce a second currency.

## Deliberate boundaries

This foundation does **not** present the following as implemented:

- customer-facing rental search or checkout
- reservation holds, booking allocation, cancellation, or amendments
- taxes, fees, deposits, discounts, or multi-day pricing rules
- quantity pools for interchangeable stock
- customer pickup/drop-off selection, one-way returns, delivery zones, opening-hour rules, or transfer pricing
- hourly rentals
- maintenance/work-order workflows beyond explicit availability blocks
- payment processing
- external marketplace, fleet, or calendar synchronization

Those features require separate commercial acceptance criteria and must not infer availability solely from these management records.

## Validation boundary

Dependency-free domain and source-contract coverage validates location normalization, timezone/country constraints, tenant-composite schema relationships, root organization foreign-key ownership, lifecycle database invariants, server-side authorization and location resolution, bounded collections, overlap rules, lifecycle dependencies, route wiring, and the no-fake-booking boundary. A guarded PostgreSQL rental scenario is included in `npm run test:database` for Tenant A/Tenant B isolation, permissions, location assignment/movement, overlap rejection, lifecycle dependencies, and audit evidence.

Live Prisma validation, migration deployment/drift verification, and the PostgreSQL integration scenario remain governed by the Phase 1 disposable-database gate and must not be claimed without the repository-supported Node 24 toolchain and an explicitly disposable database target.
