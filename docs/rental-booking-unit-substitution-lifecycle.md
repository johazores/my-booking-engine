# Rental booking physical-unit substitution lifecycle

SF supports a narrow production replacement-unit contract for an existing confirmed rental booking. Authorized staff may move the **effective physical allocation** to a different active unit when the replacement is the same booked unit type, remains at the same booked operating location, and is free for the booking's current effective date range.

This is an operational inventory substitution, not a commercial amendment. Original `RentalBooking` unit ownership, customer snapshot, source hold, booking-time dates, accepted money, pricing evidence, and conversion authority remain immutable.

## Review authority

`listRentalBookingUnitSubstitutionCandidates` and `reviewRentalBookingUnitSubstitutionAuthority` require `booking:manage`, `availability:read`, and `inventory:read`. Candidate collections are tenant-scoped and capped at 100 rows.

Review derives current effective dates from the retained allocation/latest reschedule and derives the expected current unit from the latest append-only unit substitution, or the original booking unit when no substitution exists. A stale or contradictory allocation fails closed.

The target must be a different `ACTIVE` unit in the authenticated organization with the same retained `unitTypeId` and `locationId`. Review uses PostgreSQL `clock_timestamp()` and rejects target unavailable-date blocks, effective active holds, or another non-cancelled booking allocation over the effective rental period.

A ready review receives a deterministic SHA-256 authority fingerprint binding tenant, booking, observed booking version, source unit, target unit, booked unit type/location, effective dates, exact accepted money, and the effective pricing fingerprint. A reschedule, cancellation, another substitution, or other booking-version change invalidates earlier authority.

## Durable writer

`applyRentalBookingUnitSubstitution` additionally requires `availability:manage`.

The writer runs in a serializable transaction with bounded retries. It first acquires the shared tenant/booking advisory lock, then locks the source and target physical units in deterministic ID order. After those locks it re-reads booking, allocation, latest reschedule/substitution, target inventory, PostgreSQL time, and every target conflict.

The staff route derives tenant and actor from authenticated server context. Its stable idempotency key is derived server-side from booking ID plus reviewed authority fingerprint. Exact replay returns the already-applied substitution; conflicting key reuse fails closed.

## Append-only evidence and effective allocation

Each successful mutation inserts one `rental_booking_unit_substitutions` row containing source/target unit, unchanged unit type/location, effective dates, exact accepted money, effective pricing fingerprint, reviewed authority fingerprint, idempotency key, and application timestamp.

Substitution rows are append-only. Only `RentalBookingAllocation.unitId` moves. The original booking-time `RentalBooking.unitId` never changes and remains commercial/history evidence.

Database guards derive the effective unit from the latest substitution and the effective dates from the latest reschedule. Allocation updates must match both dimensions and continue to reject blocks, effective holds, or another live booking. A deferred constraint requires the replacement allocation before commit.

## Reschedule and cancellation compatibility

Same-unit price-neutral rescheduling now operates on the **effective allocation unit**, which can be a substituted unit. It retains that unit while moving only dates.

Cancellation likewise locks and validates the effective allocation unit, then retains both reschedule and unit-substitution histories after terminal inventory release.

This ordering means substitution → reschedule, reschedule → substitution, repeated substitutions, and final cancellation all preserve one coherent effective allocation without rewriting original booking evidence.

## Staff UX

`/inventory/rentals/bookings/[booking-id]/substitute-unit` provides bounded candidate discovery, a GET review, explicit blocker states, and a POST Apply action only when fresh authority exists and the actor has availability write permission.

Booking list/detail surfaces render the effective allocated unit. Detail separately preserves the original booking-time unit and append-only substitution history.

## Deliberate boundaries

This lifecycle does not change unit type, operating location, rental dates, accepted amount, tax/fee/deposit/payment state, or fulfillment state. Price-changing amendments, cross-type upgrades/downgrades, one-way location changes, payment/deposit consequences, pickup/delivery/return, customer self-service, and external synchronization require separate commercial contracts.

No route should present those unsupported workflows as real.

## Validation

`scripts/rental-booking-unit-substitution-source-contract.test.mjs` protects the append-only persistence model, tenant/permission boundaries, deterministic booking/source/target serialization, exact write scope, server-derived idempotency, effective-unit integration with rescheduling/cancellation/read models, and the no-fake-commercial-workflow boundary.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
