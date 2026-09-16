# Rental booking unit substitution lifecycle

SF supports a deliberately narrow staff-only physical-unit substitution contract for a confirmed tenant rental booking. The effective physical unit can move to another active unit **of the same retained unit type at the same retained operating location** without changing effective dates or accepted money.

The original `RentalBooking.unitId` remains immutable booking-time evidence. Current physical inventory authority comes from the live `RentalBookingAllocation`, backed by append-only `RentalBookingUnitSubstitution` history.

## Why the contract is narrow

Physical-unit substitution does not imply a product change, location transfer, repricing, tax change, payment adjustment, or fulfillment consequence. Unit-type changes, location changes, price-changing amendments, payments/deposits, pickup/delivery/return, and fulfillment remain separate commercial contracts.

The replacement window also ends when the exclusive committed pickup window closes. Once a confirmed booking has become a missed pickup, SF no longer permits changing its physical unit under that expired rental period. Staff must use a separately authorized reschedule or cancellation path before a new assignment can make operational sense.

## Authorization and tenant scope

Candidate search requires:

- `booking:manage`
- `inventory:read`

Fresh authority review additionally requires `availability:read`.

Apply additionally requires `availability:manage`.

Every booking, allocation, substitution, target-unit, block, hold, reschedule, and retained-location lookup repeats the authenticated `organizationId`. The mutation route derives organization and actor from authenticated server context and accepts only the target unit plus the reviewed authority fingerprint. It derives idempotency server-side.

## Candidate search and fresh authority

`searchRentalBookingUnitSubstitutionCandidates` proves that the tenant booking is still confirmed, has no custody evidence, and has the exact current effective allocation. Effective dates come from the latest append-only reschedule target when present. The effective source unit comes from the latest append-only substitution target when present, otherwise from immutable booking-time evidence.

Candidate discovery and fresh review use PostgreSQL `clock_timestamp()` plus the retained operating-location timezone to derive the same local-date pickup window used by fulfillment. Pre-start and active-window bookings may still be reviewed; once the exclusive effective end date is reached, candidate search and review fail closed instead of offering replacement inventory for a missed pickup.

Candidate discovery is bounded to 50 active physical units in the same tenant, retained unit type, and retained operating location, excluding the current effective unit. Optional unit code/name search is bounded to 80 characters. Candidate discovery does not reserve inventory.

`reviewRentalBookingUnitSubstitutionAuthority` then uses a serializable read transaction and PostgreSQL `clock_timestamp()` to recheck source allocation integrity, the still-open replacement window, target unavailable blocks, effective holds, and overlapping non-cancelled booking allocations.

Review blockers are:

- `NO_CHANGE` — source and target units are identical;
- `TARGET_UNAVAILABLE` — target identity/lifecycle/type/location does not satisfy the supported contract;
- `INVENTORY_CONFLICT` — target inventory is blocked for the exact effective period.

A closed pickup window is not a target-unit blocker. It makes the booking itself unavailable for substitution review, so candidate/review calls fail closed before target inventory is evaluated.

## Authority fingerprint

A ready review returns a version-2 deterministic SHA-256 fingerprint binding:

- organization and booking IDs;
- observed booking `updatedAt` version;
- current source and requested target physical unit IDs;
- retained unit type and operating location IDs;
- exact effective start/end dates;
- accepted currency and total minor units;
- effective pricing fingerprint, including latest append-only reschedule pricing when applicable.

The review itself reserves nothing. `applyRentalBookingUnitSubstitution` reacquires write authority under locks before mutating anything. If a review was produced before the exclusive-end boundary but submitted after it, PostgreSQL rejects the insert through the pickup-window guard rather than allowing stale authority to cross the missed-pickup boundary.

## Durable writer

`applyRentalBookingUnitSubstitution` requires `booking:manage`, `availability:read`, `availability:manage`, and `inventory:read`.

The writer runs in a serializable transaction with bounded retries. It acquires the tenant/booking advisory lock first, then locks the current source and requested target physical units in deterministic lexical order. Under those locks it:

1. resolves the latest append-only substitution and reschedule evidence;
2. verifies the exact current allocation, active source/target units, retained unit type, and retained operating location;
3. uses PostgreSQL time for effective-hold checks;
4. rejects target unavailable blocks, effective holds, and other non-cancelled booking allocations;
5. rebuilds the versioned substitution fingerprint and rejects stale review authority;
6. inserts append-only `RentalBookingUnitSubstitution` evidence;
7. moves only `RentalBookingAllocation.unitId` from the exact observed source to target;
8. advances booking `updatedAt` without rewriting immutable booking-time unit/date/money evidence;
9. records a secret-free `booking.rental.unit-substituted` audit event.

Idempotency is derived from booking ID, target unit ID, and reviewed authority. Replay succeeds only while the matching substitution is still the latest/current substitution and the effective allocation still points at its target. Replaying older substitution authority after a later substitution fails closed instead of pretending the old target is current.

## Database protection

The substitution lifecycle migration adds same-tenant booking/source/target foreign keys, append-only substitution evidence, and a database function that resolves the effective physical unit from the latest substitution target or original booking-time unit.

Database guards use that effective unit for:

- booking allocation validation;
- confirmed-booking exact-allocation checks;
- reschedule source/target allocation checks;
- cancellation serialization;
- substitution source/target validation.

The substitution insert trigger takes the same booking and deterministic source/target unit locks, validates same-type/same-location lifecycle evidence, exact dates/money/pricing evidence, and target conflicts. A deferred constraint requires the target allocation before commit.

A later pickup-window guard independently takes the same tenant/booking advisory lock, resolves the retained location and latest supported reschedule dates, uses PostgreSQL `clock_timestamp()` in that retained IANA timezone, and rejects substitution inserts at or after the exclusive effective end date. This closes the race where fresh review authority could become stale at the local-date boundary before the POST commits.

Rental units with a non-cancelled booking allocation cannot be archived, relocated, or retyped at the database boundary. This prevents an inventory-management write from invalidating the effective booked assignment while a booking is live.

## Staff UX and read model

`/inventory/rentals/bookings/[booking-id]/unit-substitution` provides bounded candidate search and fresh review only while custody has not transferred and the pickup window has not closed. Deep links after a missed pickup show a closed replacement state instead of candidate inventory.

The booking list and detail use `RentalBookingAllocation.unit` as the current effective unit. Detail separately preserves original booking-time unit evidence and renders append-only substitution history, so operations staff can distinguish current inventory authority from historical booking evidence. Both list and detail remove the **Replace unit** action after the booking becomes a missed pickup, while supported reschedule/cancellation remediation remains separate.

## Validation boundary

Focused domain/source contracts protect versioned fingerprinting, server-derived idempotency, bounded tenant-scoped candidate search, deterministic dual-unit serialization, stale-authority rejection, append-only persistence, effective-unit database guards, neighboring reschedule/cancellation behavior, staff-route authority, and the missed-pickup substitution cutoff.

`scripts/rental-unit-substitution-pickup-window-source-contract.test.mjs` specifically protects the PostgreSQL-time/location-timezone review boundary, the direct-write trigger, and removal of staff replacement actions after the exclusive committed end.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Database behavior must be validated through `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
