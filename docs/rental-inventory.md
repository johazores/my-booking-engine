# Rental inventory

SF rental inventory is a tenant-owned production foundation for rentable physical inventory. It separates catalog, operating-location, availability-calendar, temporary inventory protection, pricing evidence, rate configuration, durable physical-unit allocation, and a staff-only rental booking interaction layer. The current booking foundation can convert an active hold into a confirmed rental booking and expose tenant-scoped staff history/detail, while payment, fulfillment, cancellation/amendment, and customer self-service remain separate contracts.

## Implemented scope

- Rental unit types with tenant-local codes, currency, and a required default daily price in minor units.
- Tenant-owned operating/home locations with tenant-local codes, postal address fields, two-letter country code, IANA timezone, and active/archive lifecycle.
- Individually managed rental units linked to a unit type and, for newly created units, an active tenant location. Existing pre-location rows may remain temporarily unassigned after migration and can be assigned from the unit detail screen.
- Audited unit relocation between active locations. Reassigning a unit to its current location is idempotent.
- Unit-level unavailable-date blocks using half-open calendar ranges `[startsOn, endsOn)`.
- Unit-type date-range daily price overrides. Overlapping active pricing periods for a unit type are rejected.
- An internal inventory availability and pricing preview under `/inventory/rentals/availability`. The preview is server-authorized, tenant-scoped, bounded to 90 days, and excludes units blocked by unavailable dates, effective holds, or overlapping non-cancelled rental booking allocations.
- Durable temporary availability holds for a specific physical unit and half-open date range. Hold creation is organization-idempotent, uses a 1-30 minute expiry, and records `ACTIVE`, `RELEASED`, `EXPIRED`, or `CONSUMED` lifecycle evidence.
- New rental holds persist server-derived creation-time pricing evidence: currency, total minor units, a canonical SHA-256 pricing fingerprint, the bounded pricing snapshot, and observation time. Historical pre-evidence holds remain readable as legacy records rather than fabricating a quote.
- A protected active-hold view under `/inventory/rentals/holds`, with explicit release actions for roles that have `availability:manage`. Each hold links to a tenant-safe pricing review that compares the immutable creation-time fingerprint with freshly calculated current rate configuration.
- A conversion authority review that combines one tenant-owned active hold, one active tenant customer, current pricing, current inventory state, and a deterministic authority fingerprint before durable confirmation can be attempted.
- A staff conversion interaction on `/inventory/rentals/holds/[hold-id]` with bounded active-customer search, server-side authority review, and a confirmation action only for ready authority plus the required write permission.
- A durable rental booking writer that atomically consumes the exact active hold, snapshots customer and commercial evidence, creates a `RentalBooking`, creates the exact `RentalBookingAllocation`, and records a secret-free audit event in one serializable transaction.
- Tenant-scoped, paginated rental booking history under `/inventory/rentals/bookings` and retained booking evidence under `/inventory/rentals/bookings/[booking-id]`, both protected by `booking:read`.
- Confirmed rental allocations participate in availability, hold creation, unavailable-date blocks, and unit mutation guards so committed inventory cannot be offered or re-protected concurrently.
- Customer profile de-identification treats both hospitality and rental booking references as retention boundaries. A confirmed rental booking therefore prevents the mutable customer profile from being independently de-identified while the booking snapshot remains retained.
- Server-side `inventory:read` / `inventory:manage` authorization for inventory, `availability:read` / `availability:manage` for holds, `pricing:read` for pricing review, and the booking/customer permissions required by the rental conversion authority, confirmation writer, and staff read model.
- Tenant-scoped reads and mutations; resource identifiers, idempotency keys, submitted codes, hold IDs, customer IDs, booking IDs, and authority fingerprints never grant scope without the authenticated `organizationId`.
- Database-enforced tenant roots, organization-composite inventory relationships, booking insert guards, immutable booking evidence, per-unit advisory serialization, and deferred exact-allocation validation.
- Archive lifecycle for commercial unit type, unit, and location rows. Unit types cannot be archived while active units remain. Locations cannot be archived while active units are assigned. Unit relocation/retyping/archive is blocked when active or future non-cancelled rental allocations still depend on that unit.
- Database pricing-evidence invariants allow legacy holds with no evidence but reject partially populated evidence, invalid currency/fingerprint formats, non-positive quoted totals, and non-object snapshots. Populated hold pricing evidence is immutable.
- Explicit `ARCHIVE` and `REMOVE` confirmations for destructive inventory management operations.
- Audit events for location, unit type, unit, relocation, block, rate, hold lifecycle, and rental booking confirmation.
- Independently bounded pagination for unit types, locations, units, unavailable-date blocks, rate periods, availability preview results, effective holds, active-customer conversion search, and rental booking history.
- Real inventory management UI under `/inventory/rentals`, with dedicated unit-type, location, unit, availability-preview, hold-management, hold-pricing/conversion-review, and rental booking list/detail pages.

## Location semantics

A rental location is inventory metadata representing the current operating/home location of physical stock. It is tenant-owned and can organize units without inventing customer pickup or drop-off promises.

Location codes are canonical tenant-local identifiers. Unit creation resolves the submitted location code server-side against the active organization, and unit relocation repeats that tenant-scoped lookup before persistence. A location cannot be archived while any active unit still references it. Historical archived units may retain the location relationship so previous inventory state is not erased.

This model does **not** make a location a customer-selected pickup or drop-off promise. Pickup/drop-off eligibility, one-way returns, delivery zones, transfer fees, opening hours, location-specific taxes, and related booking terms require separate rental workflow acceptance criteria.

## Date, hold, pricing, and booking semantics

Calendar records are date-only PostgreSQL `DATE` values. The end date is exclusive. For example, a block, hold, or allocation from `2026-10-01` through `2026-10-04` covers October 1, 2, and 3.

Pricing is stored only as integer minor units. A unit type owns its currency; rate periods override the daily amount for a date range but never introduce a second currency.

### Inventory availability and pricing preview

The read-only preview resolves an active unit type code and optional active location code inside the authenticated organization. Candidate units must be active, assigned to an active tenant location, belong to the requested active unit type, have no explicit unavailable-date block, have no effective overlapping `ACTIVE` hold, and have no overlapping non-cancelled rental booking allocation. Results are independently paginated and bounded to a maximum 90-day window.

Effective pricing is calculated from the unit type default daily rate plus configured rate-period overrides. The calculation is deterministic per calendar day and remains in integer minor units. Persisted overlapping rate periods or invalid persisted amounts fail closed as integrity errors. A canonical fingerprint binds the unit-type identity, currency, stay dates, exact total, and segmented rate sources so later authority can compare pricing without trusting mutable UI state.

### Holds and conversion

Roles with `availability:manage` may turn a currently available result into a short-lived internal hold. Hold creation revalidates the physical unit, active tenant location, unavailable-date blocks, other effective holds, non-cancelled rental booking allocations, and current pricing server-side under the same physical-unit serialization boundary.

Every newly created hold snapshots the pricing observation used at creation and stores its fingerprint. That evidence is immutable and deliberately separate from mutable current pricing. `/inventory/rentals/holds/[hold-id]` recalculates the current quote and reports whether it still matches the original observation.

A temporary hold is **not** itself a customer booking or payment authority. The staff conversion surface first binds a real active tenant customer to the existing server-side conversion authority. `confirmRentalBookingFromHold` then revalidates the active customer, effective hold, physical-unit state, current price, booked-allocation conflicts, and exact authority fingerprint under serializable locks. The writer consumes the hold and creates the durable booking/allocation atomically. A stale review or browser state is never accepted as write authority.

The confirmation route derives tenant and actor identity from the authenticated server context and derives the stable confirmation idempotency key from the hold plus selected customer rather than accepting those authority fields from browser input. The durable list/detail read model similarly repeats authenticated tenant scope at every booking query.

`CONFIRMED` in the current rental contract means SF has committed the physical unit to the customer under the reviewed price. It does not mean money has been collected, a deposit has been authorized, or pickup/delivery/return terms have been agreed.

Expiry remains authoritative by timestamp: an `ACTIVE` hold whose `expiresAt` is no longer in the future stops protecting availability even before lifecycle cleanup updates its stored status. Explicit release changes an effective hold to `RELEASED`; releasing an already time-expired active record records it as `EXPIRED`; successful durable booking conversion changes the exact hold to `CONSUMED`.

## Deliberate boundaries

The following are **not** presented as implemented:

- customer-facing rental search, checkout, or self-service booking management
- staff-facing rental cancellation, amendments, or rescheduling
- payment processing, deposits, discounts, taxes/fees, or multi-day pricing rules beyond configured daily-rate overrides
- customer pickup/drop-off selection, one-way returns, delivery zones, opening-hour rules, or transfer pricing
- quantity pools for interchangeable stock
- hourly rentals
- maintenance/work-order workflows beyond explicit unavailable-date blocks
- external marketplace, fleet, supplier, or calendar synchronization
- rental fulfillment notifications or operational pickup/return workflows

Those features require separate commercial acceptance criteria. The current production contract stops at staff-reviewed durable confirmed inventory commitment plus tenant-scoped history/detail and does not present unimplemented logistics or financial behavior as real.

## Validation boundary

Dependency-free domain and source-contract coverage validates hold input/idempotency rules, deterministic pricing fingerprints, tenant-composite schema relationships, database checks/guards, persisted pricing evidence, server-side authorization, tenant-bound resource resolution, bounded collections, overlap behavior, inventory-mutation guard wiring, booked-allocation exclusion, conversion authority, atomic hold consumption, durable booking/allocation persistence, staff conversion/read routing, customer-retention integration, and the no-fake-commercial-workflow boundary.

Guarded PostgreSQL scenarios are registered in `npm run test:database`. When an explicitly disposable database is available they cover tenant isolation, permission denial, idempotent retries, hold pricing evidence, price revalidation, availability exclusion, block/relocation/archive protection, concurrent hold contention, rental booking confirmation races, replay, exact hold consumption, booked-inventory protection, and rental-linked customer de-identification rejection.

Live Prisma validation, migration deployment/drift verification, and PostgreSQL integration scenarios remain governed by the Phase 1 disposable-database gate and must not be claimed without the repository-supported Node 24 toolchain and an explicitly disposable database target.
