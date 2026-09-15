# Rental inventory

SF rental inventory is a tenant-owned production foundation for rentable physical inventory. It separates catalog, operating-location, availability-calendar, temporary inventory protection, pricing evidence, rate configuration, durable physical-unit allocation, and staff rental booking lifecycle. The current booking workflow supports hold-to-booking confirmation, tenant-scoped history/detail, same-unit price-neutral date rescheduling, same-type/same-location physical-unit substitution, and terminal inventory-release cancellation. Payment/deposit, unit-type/location-changing amendments, price-changing amendments, fulfillment, and customer self-service remain separate contracts.

## Implemented scope

- Rental unit types with tenant-local codes, currency, and a required default daily price in minor units.
- Tenant-owned operating/home locations with tenant-local codes, postal address fields, two-letter country code, IANA timezone, and active/archive lifecycle.
- Individually managed rental units linked to a unit type and active tenant location for newly created units.
- Audited unit relocation between active locations, blocked while the unit has a non-cancelled booking allocation.
- Unit-level unavailable-date blocks using half-open calendar ranges `[startsOn, endsOn)`.
- Unit-type date-range daily price overrides with overlap rejection.
- Read-only availability/pricing preview under `/inventory/rentals/availability`, bounded to 90 days and excluding unavailable blocks, effective holds, and overlapping non-cancelled rental booking allocations.
- Durable temporary availability holds for a specific physical unit/date range, with organization idempotency, 1-30 minute expiry, and `ACTIVE`, `RELEASED`, `EXPIRED`, or `CONSUMED` lifecycle evidence.
- Immutable hold pricing evidence: currency, total minor units, canonical SHA-256 pricing fingerprint, bounded pricing snapshot, and observation time.
- Protected hold management and current-price review.
- Conversion authority that binds an active tenant hold, active tenant customer, current inventory, current pricing, and deterministic authority fingerprint.
- Staff conversion interaction with bounded customer search and confirmation only after fresh authority.
- A durable rental booking writer that consumes the exact hold, snapshots customer/commercial evidence, creates `RentalBooking`, creates exact `RentalBookingAllocation`, and records a secret-free audit event in one serializable transaction.
- Tenant-scoped, paginated rental booking history and detail protected by `booking:read`.
- Same-unit, price-neutral date rescheduling with fresh target inventory/pricing review, versioned authority fingerprint, server-derived idempotency, serializable booking/effective-unit locks, append-only reschedule evidence, exact effective allocation update, stale-authority protection, and audit evidence.
- Same-type, same-location physical-unit substitution with bounded candidate search, fresh target inventory review, version-2 authority fingerprint, deterministic booking/source/target locks, server-derived idempotency, append-only substitution evidence, exact effective allocation-unit move, stale-authority protection, and audit evidence.
- Explicit staff cancellation for a confirmed booking with `booking:manage` plus `availability:manage`. Cancellation records terminal `CANCELLED`, retains historical allocation/reschedule/substitution evidence, and releases live inventory protection.
- Confirmed rental allocations participate in availability, hold creation, unavailable-date blocks, substitution, and unit mutation guards. Cancelled parent bookings make retained allocations non-blocking.
- Customer de-identification treats hospitality and rental booking references, including cancelled rental bookings, as retention boundaries.
- Server-side authorization for inventory, availability, pricing, booking, and customer capabilities used by each workflow.
- Tenant-scoped reads and mutations; resource identifiers, idempotency keys, codes, hold IDs, customer IDs, booking IDs, target-unit IDs, and authority fingerprints never grant scope without authenticated `organizationId`.
- Database-enforced tenant roots, organization-composite relationships, booking insert guards, immutable booking-time evidence, append-only reschedule/substitution evidence, effective-allocation guards, terminal cancellation guard, per-unit advisory serialization, and deferred exact-allocation validation.
- Archive lifecycle for commercial inventory rows with dependency-safe constraints.
- Database pricing-evidence invariants that allow legacy holds without evidence but reject partially populated or invalid evidence.
- Explicit destructive confirmations for inventory removal/archive and booking cancellation.
- Audit events for inventory, hold, booking confirmation, booking reschedule, booking unit substitution, and booking cancellation.
- Independently bounded pagination for rental management collections.
- Real inventory UI under `/inventory/rentals` with unit-type, location, unit, availability, hold, conversion, booking list/detail, reschedule, unit-substitution, and cancellation surfaces.

## Location semantics

A rental location is inventory metadata representing the current operating/home location of physical stock. It does not by itself promise customer pickup/drop-off availability.

Location codes are canonical tenant-local identifiers. Unit creation and relocation resolve locations server-side inside the authenticated organization. A location cannot be archived while an active unit depends on it. A unit with a non-cancelled booking allocation cannot be relocated, archived, or retyped; staff must first use a supported booking lifecycle operation such as same-location substitution or cancellation.

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

The staff conversion workflow binds an active tenant customer. `confirmRentalBookingFromHold` revalidates customer, effective hold, physical-unit state, current price, allocation conflicts, and authority fingerprint under serializable locks. It consumes the hold and creates booking/allocation atomically.

`CONFIRMED` means SF has committed physical inventory under reviewed commercial evidence. It does not mean money was collected, a deposit was authorized, or fulfillment occurred.

### Same-unit price-neutral rescheduling

Authorized staff may review a new date range for the current effective confirmed physical unit. Review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`; apply additionally requires `availability:manage`.

Review and apply use the current effective allocation after any supported unit substitution rather than assuming immutable booking-time unit/date evidence is still operational authority. Target dates are rejected when they overlap an unavailable block, effective hold, or another non-cancelled booking. Target pricing must preserve accepted currency and exact aggregate amount.

Apply reacquires tenant/booking and effective physical-unit locks, rebuilds authority, derives idempotency server-side, inserts append-only `rental_booking_reschedules` evidence, moves only effective allocation dates, advances booking version, and records audit evidence.

See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

### Same-type same-location physical-unit substitution

Authorized staff may replace the current effective unit with another active unit under the same retained product/type and operating location while dates and accepted money remain unchanged.

Candidate discovery is bounded and does not reserve inventory. Fresh review uses PostgreSQL time and rejects target blocks, effective holds, other non-cancelled allocations, wrong tenant/type/location, inactive lifecycle, and no-op targets. The version-2 authority fingerprint binds booking version, current source, target, retained type/location, effective dates, exact accepted money, and effective pricing evidence.

Apply reacquires the booking lock and both physical-unit locks in deterministic order, rebuilds authority, inserts append-only substitution evidence, moves only `RentalBookingAllocation.unitId`, advances the booking version, and records audit evidence. Original `RentalBooking.unitId` remains immutable booking-time history.

Database guards derive the effective unit from latest substitution history for allocation, reschedule, and cancellation authority. See [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md).

### Cancellation

Staff cancellation changes only a still-confirmed tenant booking to terminal `CANCELLED` under booking/current-effective-unit serialization. Cancellation validates current allocation after latest reschedule and substitution, retains booking/allocation/modification history, and makes retained allocation non-blocking for live inventory.

Cancellation does not perform refund, deposit, provider, tax, notification, or fulfillment actions. See [rental-booking-cancellation.md](./rental-booking-cancellation.md).

### Hold expiry

Expiry remains authoritative by timestamp: an `ACTIVE` hold whose `expiresAt` is no longer in the future stops protecting availability even before lifecycle cleanup changes its stored status. Explicit release changes an effective hold to `RELEASED`; releasing an already expired active row records `EXPIRED`; successful booking conversion changes the hold to `CONSUMED`.

## Deliberate boundaries

The following are **not** presented as implemented:

- customer-facing rental search, checkout, payment, or self-service booking management
- unit-type changes, location-changing substitutions, and price-changing rental amendments or rescheduling
- rental payment processing, deposits, cancellation fees/refunds, discounts, taxes/fees, or complex pricing beyond current daily-rate evidence
- customer pickup/drop-off selection, one-way returns, delivery zones, opening-hour rules, or transfer pricing
- quantity pools for interchangeable stock
- hourly rentals
- maintenance/work-order workflows beyond explicit unavailable-date blocks
- external marketplace, fleet, supplier, or calendar synchronization
- pickup, return, inspection, damage, or other fulfillment workflows

Those require separate commercial state machines and acceptance criteria. The current production contract stops at staff-reviewed durable inventory commitment, tenant-scoped read history, price-neutral date rescheduling, same-type/same-location physical-unit substitution, and inventory-release cancellation.

## Validation boundary

Dependency-free domain/source contracts cover deterministic pricing and authority fingerprints, tenant-composite relationships, database guards, hold evidence, authorization, tenant-bound resolution, bounded collections, overlap behavior, atomic hold consumption, durable booking/allocation persistence, reschedule/substitution authority and write scope, cancellation, customer retention, and the no-fake-financial/fulfillment boundary.

Guarded PostgreSQL scenarios remain registered under `npm run test:database` and must target an explicitly disposable database. Live Prisma validation, migration/drift checks, complete typecheck/lint/test/build, and PostgreSQL execution must not be claimed without the repository-supported Node 24 toolchain and required environment.

GitHub Actions are intentionally not required or used.
