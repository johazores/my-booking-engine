# Rental booking reschedule lifecycle

SF supports a narrow production rental reschedule contract for an existing confirmed booking: authorized staff may move the **effective dates of the same physical unit** when fresh target inventory is available and the current target-date price has the same currency and exact aggregate amount as the accepted booking.

This is not an in-place rewrite of the accepted booking evidence. The original `RentalBooking` ownership, customer snapshot, source hold, unit assignment, booking-time dates, accepted amount, pricing snapshot, and conversion authority remain immutable.

## Review authority

`reviewRentalBookingRescheduleAuthority` requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Every query repeats the authenticated `organizationId`.

The review derives the current effective source period from the retained physical allocation. After the first reschedule, the latest append-only reschedule target pricing fingerprint becomes the source pricing fingerprint for the next review.

The review uses PostgreSQL `clock_timestamp()` and revalidates confirmed, non-cancelled lifecycle, exact tenant-owned allocation, active physical assignment, unavailable blocks, effective active holds, every other non-cancelled allocation, and current target pricing.

The current booking allocation is the only booking allocation excluded from the target overlap query. A review is blocked with `NO_CHANGE`, `INVENTORY_CONFLICT`, or `PRICE_CHANGED`.

## Stale-authority protection

A ready review receives a SHA-256 authority fingerprint. Version 2 binds tenant/booking identity, current booking `updatedAt`, physical assignment, effective source dates, target dates, exact unchanged money, current source pricing fingerprint, and current target pricing fingerprint.

Every successful reschedule explicitly advances the booking `updatedAt` version without rewriting immutable commercial evidence. Reusing authority from an earlier booking version therefore fails closed.

## Durable writer

`applyRentalBookingReschedule` requires `booking:manage`, `availability:read`, `availability:manage`, `inventory:read`, and `pricing:read`.

The writer runs in a serializable transaction with bounded retries. It acquires the same tenant/booking advisory lock used by cancellation and the shared tenant/physical-unit lock used by rental inventory, then repeats lifecycle, allocation, target inventory, pricing, and authority checks.

The staff route derives a stable idempotency key from the booking ID plus reviewed authority fingerprint. Exact replay returns the already-applied reschedule; reuse for different authority or dates is rejected.

## Append-only evidence and effective allocation

Each successful mutation inserts one `rental_booking_reschedules` row containing source/target dates, unchanged money, source/target pricing fingerprints, target pricing snapshot, authority fingerprint, idempotency key, and application timestamp.

The row is append-only. Database triggers reject update or delete. Only the operational `RentalBookingAllocation` dates move. Original `RentalBooking` ownership and commercial evidence remain immutable.

Database guards require the live allocation to match the latest append-only reschedule target (or original booking dates when no reschedule exists). The allocation guard still takes the shared physical-unit lock and rejects unavailable blocks, effective holds, or another live booking. A deferred constraint rejects a reschedule insert unless its target allocation is present before commit.

## Cancellation and read model

Cancellation validates the current effective allocation, including the latest reschedule target, before transitioning to terminal `CANCELLED`. Its audit event records the effective dates being released.

Rental booking list/detail pages render effective allocation dates. Detail separately preserves original booking-time dates and append-only reschedule history.

## Deliberate boundaries

This lifecycle does not implement physical-unit substitution, price-changing amendments, payment/deposit collection or adjustment, cancellation financial policy, fulfillment lifecycle, customer self-service, or external provider synchronization.

Those require separate commercial state machines and acceptance criteria.

## Validation

`scripts/rental-booking-reschedule-source-contract.test.mjs` protects the append-only persistence model, database guards, tenant/permission boundary, shared locks, exact write scope, server-derived idempotency, UI apply wiring, cancellation compatibility, and no-fake-commercial-workflow boundary.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
