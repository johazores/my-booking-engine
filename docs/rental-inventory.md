# Rental inventory

SF rental inventory is a tenant-owned production foundation for rentable physical inventory. It separates catalog, operating-location, availability-calendar, temporary inventory protection, pricing evidence, rate configuration, durable physical-unit allocation, and staff rental booking lifecycle. The current booking workflow supports hold-to-booking confirmation, tenant-scoped history/detail, same-unit, price-neutral date rescheduling, and terminal inventory-release cancellation. Payment/deposit, unit substitution, price-changing amendments, fulfillment, and customer self-service remain separate contracts.

## Implemented scope

- Rental unit types with tenant-local codes, currency, and a required default daily price in minor units.
- Tenant-owned operating/home locations with tenant-local codes, postal address fields, two-letter country code, IANA timezone, and active/archive lifecycle.
- Individually managed rental units linked to a unit type and active tenant location for newly created units.
- Audited unit relocation between active locations.
- Unit-level unavailable-date blocks using half-open calendar ranges `[startsOn, endsOn)`.
- Unit-type date-range daily price overrides with overlap rejection.
- Read-only availability/pricing preview under `/inventory/rentals/availability`, bounded to 90 days and excluding unavailable blocks, effective holds, and overlapping non-cancelled rental booking allocations.
- Durable temporary availability holds for a specific physical unit/date range, with organization idempotency, 1-30 minute expiry, and `ACTIVE`, `RELEASED`, `EXPIRED`, or `CONSUMED` lifecycle evidence.
- Immutable hold pricing evidence: currency, total minor units, canonical SHA-256 pricing fingerprint, bounded pricing snapshot, and observation time.
- Protected hold management and current-price review.
- Conversion authority that binds an active tenant hold, active tenant customer, current inventory, current pricing, and deterministic authority fingerprint.
- Staff conversion interaction with bounded customer search and confirmation only after fresh authority.
- A durable rental booking writer that consumes the exact hold, snapshots customer/commercial evidence, creates `RentalBooking`, creates the exact `RentalBookingAllocation`, and records a secret-free audit event in one serializable transaction.
- Tenant-scoped, paginated rental booking history and detail protected by `booking:read`.
- Same-unit, price-neutral date rescheduling with fresh target inventory/pricing review, versioned authority fingerprint, server-derived idempotency, serializable booking/unit locks, append-only reschedule evidence, exact effective allocation update, stale-authority protection, and audit evidence.
- Explicit staff cancellation for a confirmed booking with `booking:manage` plus `availability:manage`. Cancellation records terminal `CANCELLED`, retains historical allocation/reschedule evidence, and releases live inventory protection.
- Confirmed rental allocations participate in availability, hold creation, unavailable-date blocks, and unit mutation guards. Cancelled parent bookings make retained allocations non-blocking.
- Customer de-identification treats hospitality and rental booking references, including cancelled rental bookings, as retention boundaries.
- Server-side authorization for inventory, availability, pricing, booking, and customer capabilities used by each workflow.
- Tenant-scoped reads and mutations; resource identifiers, idempotency keys, codes, hold IDs, customer IDs, booking IDs, and authority fingerprints never grant scope without authenticated `organizationId`.
- Database-enforced tenant roots, organization-composite relationships, booking insert guards, immutable booking-time evidence, append-only reschedule evidence, effective-allocation guards, terminal cancellation guard, per-unit advisory serialization, and deferred exact-allocation validation.
- Archive lifecycle for commercial inventory rows with dependency-safe constraints.
- Database pricing-evidence invariants that allow legacy holds without evidence but reject partially populated or invalid evidence.
- Explicit destructive confirmations for inventory removal/archive and booking cancellation.
- Audit events for inventory, hold, booking confirmation, booking reschedule, and booking cancellation.
- Independently bounded pagination for rental management collections.
- Real inventory UI under `/inventory/rentals` with unit-type, location, unit, availability, hold, conversion, booking list/detail, reschedule, and cancellation surfaces.

## Location semantics

A rental location is inventory metadata representing the current operating/home location of physical stock. It does not by itself promise customer pickup/drop-off availability.

Location codes are canonical tenant-local identifiers. Unit creation and relocation resolve locations server-side inside the authenticated organization. A location cannot be archived while an active unit depends on it.

Pickup/drop-off eligibility, one-way returns, delivery zones, transfer fees, opening hours, location-specific taxes, and related booking terms require separate acceptance criteria.

## Date, hold, pricing, and booking semantics

Calendar records are PostgreSQL `DATE` values with an exclusive end. A range from `2026-10-01` through `2026-10-04` covers October 1, 2, and 3.

Pricing uses integer minor units. A unit type owns its currency; rate periods override the daily amount for a date range without introducing another currency.

### Availability and pricing preview

The preview resolves active tenant inventory and rejects unavailable blocks, effective `ACTIVE` holds, and overlapping non-cancelled rental allocations. Results are bounded to 90 days.

Pricing is deterministic from default daily rate plus rate-period overrides. A canonical fingerprint binds unit type, currency, dates, exact total, and segmented rate sources so later authority can compare immutable evidence with current configuration.

### Holds and booking conversion

Roles with `availability:manage` may turn a current availability result into a short-lived hold. Hold creation revalidates the unit, location, blocks, effective holds, non-cancelled booking allocations, and current pricing under the shared physical-unit serialization boundary.

Every new hold snapshots pricing evidence. A hold is not a customer booking or payment authority.

The staff conversion workflow binds an active tenant customer. `confirmRentalBookingFromHold` revalidates the customer, effective hold, physical-unit state, current price, allocation conflicts, and authority fingerprint under serializable locks. It consumes the hold and creates the booking/allocation atomically.

`CONFIRMED` means SF has committed physical inventory under reviewed commercial evidence. It does not mean money was collected, a deposit was authorized, or fulfillment occurred.

### Same-unit price-neutral rescheduling

Authorized staff may review a new date range for the same confirmed physical unit. Review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`; apply additionally requires `availability:manage`.

Review and apply use the current effective allocation rather than rewriting original booking-time dates. Target dates are rejected when they overlap an unavailable block, effective hold, or another non-cancelled booking. Target pricing is rebuilt from current rate configuration and must preserve the accepted currency and exact aggregate amount.

A version-2 SHA-256 authority fingerprint binds the tenant/booking, current booking `updatedAt`, physical assignment, effective source dates, target dates, accepted money, effective source pricing fingerprint, and target pricing fingerprint.

Apply reacquires the tenant/booking and physical-unit locks, rebuilds all authority, derives idempotency server-side, inserts an append-only `rental_booking_reschedules` row, moves only the effective allocation dates, advances the booking version, and records audit evidence. Database guards require the effective allocation to match the latest reschedule target and reject updates/deletes of reschedule evidence.

See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

### Cancellation

Staff cancellation changes only a still-confirmed tenant booking to terminal `CANCELLED` under the same booking/unit serialization boundaries. Cancellation validates the current effective allocation, including the latest reschedule target, retains booking/allocation/reschedule history, and then makes the retained allocation non-blocking for live inventory.

Cancellation does not perform refund, deposit, provider, tax, notification, or fulfillment actions. See [rental-booking-cancellation.md](./rental-booking-cancellation.md).

### Hold expiry

Expiry remains authoritative by timestamp: an `ACTIVE` hold whose `expiresAt` is no longer in the future stops protecting availability even before lifecycle cleanup changes its stored status. Explicit release changes an effective hold to `RELEASED`; releasing an already expired active row records `EXPIRED`; successful booking conversion changes the hold to `CONSUMED`.

## Deliberate boundaries

The following are **not** presented as implemented:

- customer-facing rental search, checkout, payment, or self-service booking management
- physical-unit substitution and price-changing rental amendments or rescheduling
- rental payment processing, deposits, cancellation fees/refunds, discounts, taxes/fees, or complex pricing beyond current daily-rate evidence
- customer pickup/drop-off selection, one-way returns, delivery zones, opening-hour rules, or transfer pricing
- quantity pools for interchangeable stock
- hourly rentals
- maintenance/work-order workflows beyond explicit unavailable-date blocks
- external marketplace, fleet, supplier, or calendar synchronization
- pickup, return, inspection, damage, or other fulfillment workflows

Those require separate commercial state machines and acceptance criteria. The current production contract stops at staff-reviewed durable inventory commitment, tenant-scoped read history, same-unit price-neutral rescheduling, and inventory-release cancellation.

## Validation boundary

Dependency-free domain/source contracts cover deterministic pricing and authority fingerprints, tenant-composite relationships, database guards, hold evidence, authorization, tenant-bound resolution, bounded collections, overlap behavior, atomic hold consumption, durable booking/allocation persistence, same-unit price-neutral reschedule authority/write scope, cancellation, customer retention, and the no-fake-financial/fulfillment boundary.

Guarded PostgreSQL scenarios remain registered under `npm run test:database` and must target an explicitly disposable database. Live Prisma validation, migration/drift checks, complete typecheck/lint/test/build, and PostgreSQL execution must not be claimed without the repository-supported Node 24 toolchain and required environment.

GitHub Actions are intentionally not required or used.
