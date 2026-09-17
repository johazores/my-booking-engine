# Rental booking reschedule and custody-extension lifecycle

SF supports two narrow production date-change contracts for an existing confirmed rental booking on its **current effective physical unit**:

1. before pickup, authorized staff may move the effective dates when fresh target inventory is available and current target-date pricing preserves the accepted currency and exact aggregate amount;
2. after pickup and before return, authorized staff may only keep the current effective start date and move the committed end date later, again only when fresh inventory is available and the accepted aggregate amount remains unchanged.

The second path is a custody extension, not an arbitrary in-custody reschedule. It cannot move the start date, shorten the period, replace the physical unit, or change the accepted price.

This lifecycle never rewrites accepted booking evidence. Original `RentalBooking` ownership, customer snapshot, source hold, booking-time unit assignment, booking-time dates, accepted amount, pricing snapshot, and conversion authority remain immutable. If a supported physical-unit substitution already occurred before pickup, date-change authority follows that current effective unit from append-only substitution history.

## Review authority

`reviewRentalBookingRescheduleAuthority` requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Every query repeats the authenticated `organizationId`.

The review derives the current effective source period from retained allocation/latest append-only reschedule evidence and derives the current effective physical unit from latest append-only substitution evidence. After the first date change, the latest target pricing fingerprint becomes source pricing evidence for the next review.

The review also reads tenant-owned fulfillment evidence. A retained `RETURNED` event closes date-change authority. With no pickup, the normal pre-pickup reschedule contract applies. With a retained `PICKED_UP` event and no return, review switches to `CUSTODY_EXTENSION`: target start must equal the current effective start and target end must be later than the current effective end.

The review uses PostgreSQL `clock_timestamp()` and revalidates confirmed, non-cancelled lifecycle, exact tenant-owned effective allocation, active physical assignment, unavailable blocks, effective active holds, every other non-cancelled allocation, overdue custody from other bookings, and current target pricing.

The current booking allocation is the only booking allocation and overdue-custody source excluded from the target conflict query. Review can be blocked with `NO_CHANGE`, `CUSTODY_EXTENSION_REQUIRED`, `INVENTORY_CONFLICT`, or `PRICE_CHANGED`.

## Stale-authority protection

A ready review receives a SHA-256 authority fingerprint. Version 3 binds tenant/booking identity, current booking `updatedAt`, **current effective physical assignment**, effective source dates, target dates, exact unchanged money, current source pricing fingerprint, current target pricing fingerprint, authority mode, and the immutable pickup-event ID when custody has started.

Binding custody mode and pickup ID is required because pickup itself does not rewrite immutable booking commercial evidence. A pre-pickup review therefore cannot be reused silently after pickup; the writer rebuilds a different custody-bound authority and requires a fresh extension review.

Every successful date change or physical-unit substitution also advances booking `updatedAt` without rewriting immutable commercial evidence. Reusing authority from an earlier booking version fails closed.

## Durable writer

`applyRentalBookingReschedule` requires `booking:manage`, `availability:read`, `availability:manage`, `inventory:read`, and `pricing:read`.

The writer runs in a serializable transaction with bounded retries. It acquires the tenant/booking advisory lock, resolves the latest effective unit, acquires that shared tenant/physical-unit lock, and then repeats lifecycle, custody, allocation, target inventory, overdue-custody, pricing, and authority checks.

A fresh write is rejected after return. If pickup exists, the writer independently requires the same-start/later-end custody-extension shape before computing authority. The target must still preserve booking currency and exact accepted aggregate amount. Price-changing extension authority is intentionally not inferred from payment state or browser input.

The staff route derives a stable idempotency key from booking ID plus reviewed authority fingerprint and uses the shared safe inventory form parser. Exact replay returns the already-applied date change; reuse for different authority or dates is rejected. A successfully persisted pre-pickup reschedule can still replay after later pickup because replay does not create a new mutation.

## Database custody boundary

The original fulfillment migration made pickup a hard boundary for all new reschedule inserts. The later custody-extension migration replaces only that reschedule trigger while leaving cancellation and physical-unit substitution hard-locked after pickup.

The active reschedule custody guard uses the same tenant/booking advisory lock namespace and independently enforces:

- returned bookings cannot receive a new reschedule/extension row;
- before pickup, the existing pre-pickup reschedule contract remains available;
- after pickup, the new row's source dates must equal the current effective dates;
- target start must remain the current effective start;
- target end must be strictly later than the current effective end;
- extension application time cannot predate retained pickup evidence.

Existing reschedule insert/allocation guards still validate confirmed tenant ownership, source-chain continuity, unchanged money/pricing evidence, effective unit authority, operational availability, and deferred exact-allocation synchronization.

## Append-only evidence and effective allocation

Each successful mutation inserts one `rental_booking_reschedules` row containing source/target dates, unchanged money, source/target pricing fingerprints, target pricing snapshot, authority fingerprint, idempotency key, and application timestamp.

The row is append-only. Database triggers reject update or delete. Only operational `RentalBookingAllocation` dates move. Original `RentalBooking` ownership, unit assignment, booking-time dates, and commercial evidence remain immutable.

Database guards derive the effective unit from latest substitution history and effective dates from latest reschedule history. Allocation writes reject unavailable blocks, effective holds, another live booking, or incompatible custody authority. A deferred constraint rejects a reschedule insert unless its target allocation is present before commit.

## Downstream fulfillment and late-return semantics

A later return derives the latest reschedule target dates, so custody evidence after an extension snapshots the extended committed period. Overdue-custody reads likewise use the latest effective end date. A post-return late-return assessment compares the actual return against that retained effective committed end rather than the original booking-time end.

An extension itself does not create or waive a late fee, perform settlement, or alter existing payment evidence.

## Staff interaction

The booking detail exposes `Reschedule rental` before pickup and `Extend rental` while picked up when the actor has the required review permissions. Returned bookings expose neither action.

The shared review page fixes the start date in custody-extension mode and accepts only a later end date. UI restrictions are usability only; service and database rules remain authoritative. Apply records a distinct `booking.rental.extended` audit action for the custody path and `booking.rental.rescheduled` before pickup.

## Deliberate boundaries

This lifecycle does not implement unit-type changes, location-changing substitution, price-changing amendments or extensions, partial/split payment adjustment, automatic proration, delivery, customer self-service, or external provider synchronization.

A target whose current price changes the accepted aggregate amount remains `PRICE_CHANGED` and must not be forced through the price-neutral writer. Any future price-changing extension needs a separate commercial amendment/settlement contract.

## Validation

- `src/server/bookings/rental-booking-reschedule-domain.test.ts` covers custody-extension shape and custody-bound authority fingerprints.
- `scripts/rental-booking-reschedule-source-contract.test.mjs` protects append-only persistence, effective-unit guards, tenant/permission boundaries, locks, custody modes, exact write scope, server-derived idempotency, staff apply wiring, and immutable commercial evidence.
- `scripts/rental-booking-pre-custody-writer-source-contract.test.mjs` protects cancellation's hard custody boundary, custody-aware date-change writers, and idempotent replay behavior.
- `scripts/rental-booking-fulfillment-source-contract.test.mjs` protects the database transition from the original hard reschedule lock to the narrow custody-extension exception while cancellation and replacement remain locked.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
