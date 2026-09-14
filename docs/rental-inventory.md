# Rental inventory

SF rental inventory is a tenant-owned production foundation for rentable physical inventory. It separates catalog, operating-location, availability-calendar, temporary inventory protection, and rate configuration from later customer booking, payment, and supplier integrations.

## Implemented scope

- Rental unit types with tenant-local codes, currency, and a required default daily price in minor units.
- Tenant-owned operating/home locations with tenant-local codes, postal address fields, ISO-style two-letter country code, IANA timezone, and active/archive lifecycle.
- Individually managed rental units linked to both a unit type and, for all newly created units, an active tenant location. Existing pre-location rows may remain temporarily unassigned after migration and can be assigned from the unit detail screen.
- Audited unit relocation between active locations. Reassigning a unit to its current location is idempotent.
- Unit-level unavailable-date blocks using half-open calendar ranges `[startsOn, endsOn)`.
- Unit-type date-range daily price overrides. Overlapping active pricing periods for a unit type are rejected.
- Overlapping unavailable-date blocks for a unit are rejected.
- An internal inventory availability and pricing preview under `/inventory/rentals/availability`. The preview is server-authorized, tenant-scoped, bounded to 90 days, excludes active units with explicit overlapping unavailable-date blocks, excludes units protected by effective temporary availability holds, excludes unassigned units and units at archived locations, and computes effective default/override daily pricing using integer minor units.
- Durable temporary availability holds for a specific physical unit and half-open date range. Hold creation is organization-idempotent, uses a 1-30 minute expiry, and records `ACTIVE`, `RELEASED`, or `EXPIRED` lifecycle evidence without pretending that a hold is a booking.
- A protected active-hold view under `/inventory/rentals/holds`, with explicit release actions for roles that have `availability:manage`.
- Server-side `inventory:read` / `inventory:manage` authorization for inventory and `availability:read` / `availability:manage` authorization for temporary holds.
- Tenant-scoped reads and mutations; resource identifiers, idempotency keys, and submitted location codes are never sufficient without the authenticated `organizationId`.
- Database-enforced tenant roots: root rental unit types and locations have PostgreSQL foreign keys to their owning organization, while unit/block/rate/hold relationships remain organization-composite.
- Archive lifecycle for commercial unit type, unit, and location rows. Unit types cannot be archived while active units remain. Locations cannot be archived while active units are assigned. Archiving a unit retains historical unavailable-date blocks and its last location reference.
- Database lifecycle invariants: status/archive timestamp consistency is enforced with database checks for unit types, physical units, and locations; hold status/ended-at consistency and valid hold date/expiry ranges are also checked.
- Database guard triggers serialize the same physical-unit mutation boundary and reject active-hold overlap with unavailable-date blocks, reject overlapping effective holds, and prevent relocating, retyping, or archiving a unit while it has an effective active hold. Application services perform the same expected-state checks first so ordinary conflicts return product-level errors while the database remains the final race-safety boundary.
- Explicit `ARCHIVE` and `REMOVE` confirmations for destructive inventory management operations.
- Audit events for location, unit type, unit, relocation, block, rate, and hold lifecycle mutations.
- Independently bounded pagination for unit types, locations, units, unavailable-date blocks, rate periods, availability preview results, and effective holds.
- Real management UI under `/inventory/rentals`, with dedicated unit-type, location, unit, availability-preview, and hold-management pages.

## Location semantics

A rental location is inventory metadata representing the current operating/home location of physical stock. It is tenant-owned and can be used to organize units without inventing a customer booking journey.

Location codes are canonical tenant-local identifiers. Unit creation resolves the submitted location code server-side against the active organization, and unit relocation repeats that tenant-scoped lookup before persistence. A location cannot be archived while any active unit still references it. Historical archived units may retain the location relationship so previous inventory state is not erased.

This model does **not** make a location a customer-selected pickup or drop-off promise. Pickup/drop-off eligibility, one-way returns, delivery zones, transfer fees, opening hours, location-specific taxes, and booking allocation require separate rental workflow acceptance criteria.

## Date, hold, and pricing semantics

Calendar records are date-only PostgreSQL `DATE` values. The end date is exclusive. For example, a block or hold from `2026-10-01` through `2026-10-04` covers October 1, 2, and 3.

Pricing is stored only as integer minor units. A unit type owns its currency; rate periods override the daily amount for a date range but never introduce a second currency.

### Inventory availability and pricing preview

The read-only preview resolves an active unit type code and optional active location code inside the authenticated organization. Candidate units must be active, assigned to an active tenant location, belong to the requested active unit type, have no explicit unavailable-date blocks overlapping the full requested half-open date range, and have no effective `ACTIVE` hold whose expiry is still in the future and whose dates overlap the requested range. Results are independently paginated and bounded to a maximum 90-day window.

Effective pricing is calculated from the unit type default daily rate plus configured rate-period overrides. The calculation is deterministic per calendar day and remains in integer minor units. Persisted overlapping rate periods or invalid persisted amounts fail closed as an integrity error rather than selecting an arbitrary price.

Roles with `availability:manage` may turn a currently available result into a short-lived internal hold. Hold creation revalidates the physical unit, active tenant location, explicit unavailable-date blocks, and other effective holds server-side. Organization-scoped idempotency keys make exact retries return the original hold while changed payloads using the same key fail closed. The unit/date mutation boundary is serialized with PostgreSQL advisory locks and reinforced by database triggers so concurrent holds and inventory mutations cannot intentionally bypass the protection path.

A temporary hold is **not a customer reservation, booking allocation, confirmation, or payment authority**. It stores no customer identity, does not choose pickup/drop-off terms, does not allocate a booking record, and does not lock pricing. Any later rental booking workflow must revalidate price and commercial terms and must explicitly consume or otherwise convert inventory protection into durable booking allocation in one coherent transaction.

Expiry is authoritative by timestamp: an `ACTIVE` row whose `expiresAt` is no longer in the future stops protecting availability even before lifecycle cleanup updates its stored status. Explicit release changes an effective hold to `RELEASED`; releasing an already time-expired active record records it as `EXPIRED`.

## Deliberate boundaries

This foundation does **not** present the following as implemented:

- customer-facing rental search or checkout
- durable customer reservation/booking allocation, confirmation, cancellation, or amendments
- hold-to-booking consumption and customer ownership of a hold
- taxes, fees, deposits, discounts, or multi-day pricing rules beyond configured daily-rate overrides
- quantity pools for interchangeable stock
- customer pickup/drop-off selection, one-way returns, delivery zones, opening-hour rules, or transfer pricing
- hourly rentals
- maintenance/work-order workflows beyond explicit unavailable-date blocks
- payment processing
- external marketplace, fleet, or calendar synchronization

Those features require separate commercial acceptance criteria. Internal temporary holds protect physical inventory from concurrent internal allocation attempts, but they are intentionally insufficient as a customer booking lifecycle.

## Validation boundary

Dependency-free domain and source-contract coverage validates hold input/idempotency rules, tenant-composite schema relationships, database checks/guards, server-side authorization, tenant-bound resource resolution, bounded collections, overlap behavior, inventory-mutation guard wiring, availability-preview exclusion, hold UI/actions, and the no-fake-booking boundary.

A guarded PostgreSQL rental-hold scenario is registered in `npm run test:database`. When an explicitly disposable database is available it verifies Tenant A/Tenant B isolation, staff mutation denial, exact idempotent retries, changed-retry rejection, preview exclusion, block/relocation/archive protection while held, release behavior, concurrent overlapping hold contention, and audit evidence. Existing rental inventory and tenant-integrity scenarios continue to cover location assignment, pricing/block overlap rules, root organization foreign keys, organization delete protection, and archive-state database checks.

Live Prisma validation, migration deployment/drift verification, and the PostgreSQL integration scenarios remain governed by the Phase 1 disposable-database gate and must not be claimed without the repository-supported Node 24 toolchain and an explicitly disposable database target.
