# Rental inventory

SF rental inventory is a tenant-owned production foundation for rentable physical inventory. It intentionally separates the inventory layer from later booking, hold, payment, and supplier integrations.

## Implemented scope

- Rental unit types with tenant-local codes, currency, and a required default daily price in minor units.
- Individually managed rental units linked to a unit type with composite tenant-safe foreign keys.
- Unit-level availability blocks using half-open calendar ranges `[startsOn, endsOn)`.
- Unit-type date-range daily price overrides. Overlapping active pricing periods for a unit type are rejected.
- Overlapping availability blocks for a unit are rejected.
- Server-side `inventory:read` / `inventory:manage` authorization.
- Tenant-scoped reads and mutations; resource identifiers are never sufficient without `organizationId`.
- Archive lifecycle for commercial unit/unit-type rows. Unit types cannot be archived while active units remain. Archiving a unit retains its historical availability blocks.
- Explicit `ARCHIVE` and `REMOVE` confirmations for destructive management operations.
- Audit events for create/archive/block/rate mutations.
- Bounded pagination for unit types, units, availability blocks, and rate periods.
- Real management UI under `/inventory/rentals`.

## Date and pricing semantics

Calendar records are date-only PostgreSQL `DATE` values. The end date is exclusive. For example, a block from `2026-10-01` through `2026-10-04` makes October 1, 2, and 3 unavailable.

Pricing is stored only as integer minor units. A unit type owns its currency; rate periods override the daily amount for a date range but never introduce a second currency.

## Deliberate boundaries

This foundation does **not** present the following as implemented:

- customer-facing rental search or checkout
- reservation holds, booking allocation, cancellation, or amendments
- taxes, fees, deposits, discounts, or multi-day pricing rules
- quantity pools for interchangeable stock
- pickup/drop-off location logic
- hourly rentals
- maintenance/work-order workflows beyond explicit availability blocks
- payment processing
- external marketplace, fleet, or calendar synchronization

Those features require separate commercial acceptance criteria and must not infer availability solely from these management records.
