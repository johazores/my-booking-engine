# Rental booking reschedule lifecycle

SF supports a narrow production rental reschedule contract for an existing confirmed booking: authorized staff may move the **effective dates of the current effective physical unit** when fresh target inventory is available and the current target-date price has the same currency and exact aggregate amount as the accepted booking.

This is not an in-place rewrite of accepted booking evidence. Original `RentalBooking` ownership, customer snapshot, source hold, booking-time unit assignment, booking-time dates, accepted amount, pricing snapshot, and conversion authority remain immutable. If a supported physical-unit substitution already occurred, reschedule authority follows that current effective unit from append-only substitution history.

## Review authority

`reviewRentalBookingRescheduleAuthority` requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Every query repeats the authenticated `organizationId`.

The review derives the current effective source period from retained allocation/latest append-only reschedule evidence and derives the current effective physical unit from latest append-only substitution evidence. After the first reschedule, latest target pricing fingerprint becomes source pricing evidence for the next review.

The review uses PostgreSQL `clock_timestamp()` and revalidates confirmed, non-cancelled lifecycle, exact tenant-owned effective allocation, active physical assignment, unavailable blocks, effective active holds, every other non-cancelled allocation, and current target pricing.

The current booking allocation is the only booking allocation excluded from the target overlap query. A review is blocked with `NO_CHANGE`, `INVENTORY_CONFLICT`, or `PRICE_CHANGED`.

## Stale-authority protection

A ready review receives a SHA-256 authority fingerprint. Version 2 binds tenant/booking identity, current booking `updatedAt`, **current effective physical assignment**, effective source dates, target dates, exact unchanged money, current source pricing fingerprint, and current target pricing fingerprint.

Every successful reschedule or physical-unit substitution advances booking `updatedAt` without rewriting immutable commercial evidence. Reusing authority from an earlier booking version therefore fails closed.

## Durable writer

`applyRentalBookingReschedule` requires `booking:manage`, `availability:read`, `availability:manage`, `inventory:read`, and `pricing:read`.

The writer runs in a serializable transaction with bounded retries. It acquires the tenant/booking advisory lock, resolves the latest effective unit, acquires that shared tenant/physical-unit lock, and then repeats lifecycle, allocation, target inventory, pricing, and authority checks.

The staff route derives a stable idempotency key from booking ID plus reviewed authority fingerprint. Exact replay returns the already-applied reschedule; reuse for different authority or dates is rejected.

## Append-only evidence and effective allocation

Each successful mutation inserts one `rental_booking_reschedules` row containing source/target dates, unchanged money, source/target pricing fingerprints, target pricing snapshot, authority fingerprint, idempotency key, and application timestamp.

The row is append-only. Database triggers reject update or delete. Only operational `RentalBookingAllocation` dates move. Original `RentalBooking` ownership, unit assignment, and commercial evidence remain immutable.

Database guards derive the effective unit from latest substitution history and effective dates from latest reschedule history. Allocation writes reject unavailable blocks, effective holds, or another live booking. A deferred constraint rejects a reschedule insert unless its target allocation is present before commit.

## Cancellation, substitution, and read model

Cancellation validates current effective allocation after both latest reschedule and latest physical-unit substitution before transitioning to terminal `CANCELLED`. Its audit event records the effective unit/date inventory being released.

A later supported same-type/same-location unit substitution keeps these effective dates and moves only the allocation unit under separate dual-unit authority.

Rental booking list/detail pages render current allocation dates and unit. Detail separately preserves original booking-time unit/dates plus append-only reschedule and substitution history.

## Deliberate boundaries

This lifecycle does not implement unit-type changes, location-changing substitution, price-changing amendments, payment/deposit collection or adjustment, cancellation financial policy, fulfillment lifecycle, customer self-service, or external provider synchronization.

Those require separate commercial state machines and acceptance criteria.

## Validation

`scripts/rental-booking-reschedule-source-contract.test.mjs` protects the append-only persistence model, effective-unit database guards, tenant/permission boundary, shared locks, exact write scope, server-derived idempotency, UI apply wiring, substitution/cancellation compatibility, and no-fake-commercial-workflow boundary.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
