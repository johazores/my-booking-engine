# Rental booking reschedule and custody-extension lifecycle

SF supports two narrow production date-change shapes for an existing confirmed rental booking on its **current effective physical unit**:

1. before pickup, authorized staff may move the effective dates when fresh target inventory is available;
2. after pickup and before return, authorized staff may only keep the current effective start date and move the committed end date later.

Both shapes use fresh server pricing. A price-neutral result can use the direct reschedule writer. One supported same-currency price change can instead enter the protected commercial-amendment workflow, where exact adjustment evidence is retained before final apply. After that one amendment is applied, later date changes are supported only when fresh pricing preserves its accepted effective `afterTotalMinor`.

The second shape is a custody extension, not an arbitrary in-custody reschedule. It cannot move the start date, shorten the period, or replace the physical unit. A price change during an eligible custody extension uses the same one-amendment commercial workflow only when the booking has not already consumed it.

This lifecycle never rewrites original booking evidence. Original `RentalBooking` ownership, customer snapshot, source hold, booking-time unit assignment, booking-time dates, accepted amount, pricing snapshot, and conversion authority remain immutable. If a supported physical-unit substitution already occurred before pickup, date-change authority follows that current effective unit from append-only substitution history. If one commercial amendment was applied, the amendment `afterTotalMinor` and linked reschedule become the accepted effective commercial baseline while original booking money remains historical evidence.

## Review authority

`reviewRentalBookingRescheduleAuthority` requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Every query repeats the authenticated `organizationId`.

The review derives the current effective source period from retained allocation/latest append-only reschedule evidence and derives the current effective physical unit from latest append-only substitution evidence. After the first date change, the latest target pricing fingerprint becomes source pricing evidence for the next review.

The review also reads tenant-owned fulfillment evidence. A retained `RETURNED` event closes date-change authority. With no pickup, the normal pre-pickup reschedule shape applies. With a retained `PICKED_UP` event and no return, review switches to `CUSTODY_EXTENSION`: target start must equal the current effective start and target end must be later than the current effective end.

The review uses PostgreSQL `clock_timestamp()` and revalidates confirmed, non-cancelled lifecycle, exact tenant-owned effective allocation, active physical assignment, unavailable blocks, effective active holds, every other non-cancelled allocation, overdue custody from other bookings, and current target pricing.

The current booking allocation is the only booking allocation and overdue-custody source excluded from the target conflict query. Review can be blocked with `NO_CHANGE`, `CUSTODY_EXTENSION_REQUIRED`, `INVENTORY_CONFLICT`, `CURRENCY_CHANGED`, `PRICE_CHANGED`, `COMMERCIAL_AMENDMENT_ACTIVE`, or `COMMERCIAL_AMENDMENT_APPLIED`.

Current pricing is always reported back as server-derived evidence. The review classifies commercial impact as `UNCHANGED`, `INCREASE`, `DECREASE`, or `CURRENCY_CHANGED`. Same-currency increases/decreases include the exact absolute minor-unit delta between the current accepted effective total and fresh target total. Currency drift is separated from a normal price amendment because an accepted rental cannot silently change currency.

A fresh `PRICE_CHANGED` review does not become direct reschedule write authority. When no prior applied amendment has consumed the one supported commercial change, the page can expose a separate **Prepare commercial amendment** action to an actor with the required payment authority. Preparation persists server-authoritative amendment terms; exact settlement/compensation and final apply happen through the protected amendment workspace. If an amendment is already `PREPARED`, another date mutation is blocked until staff finish, compensate, or close it. If one amendment is already `APPLIED`, another price change is blocked while a genuinely price-neutral target may continue on the accepted effective amount.

## Stale-authority protection

A price-neutral ready review receives a SHA-256 reschedule authority fingerprint. Version 3 binds tenant/booking identity, current booking `updatedAt`, **current effective physical assignment**, effective source dates, target dates, exact unchanged effective money, current source pricing fingerprint, current target pricing fingerprint, authority mode, and the immutable pickup-event ID when custody has started.

A supported price-changing review receives a separate commercial review fingerprint. It additionally binds exact before/after money, absolute delta, and amendment direction so browser input cannot redefine the adjustment.

Binding custody mode and pickup ID is required because pickup itself does not rewrite immutable booking commercial evidence. A pre-pickup review therefore cannot be reused silently after pickup; the writer rebuilds a different custody-bound authority and requires a fresh extension review.

Every successful date change or physical-unit substitution also advances booking `updatedAt` without rewriting immutable commercial evidence. Reusing authority from an earlier booking version fails closed.

## Durable writers

`applyRentalBookingReschedule` requires `booking:manage`, `availability:read`, `availability:manage`, `inventory:read`, and `pricing:read`.

The direct writer runs in a serializable transaction with bounded retries. It acquires the tenant/booking advisory lock, resolves the latest effective unit, acquires that shared tenant/physical-unit lock, and then repeats lifecycle, custody, allocation, target inventory, overdue-custody, pricing, commercial-baseline, and authority checks.

A fresh direct write is rejected after return. If pickup exists, the writer independently requires the same-start/later-end custody-extension shape before computing authority. Its target must preserve the current accepted effective currency and aggregate amount. After one applied amendment, that amount is the amendment `afterTotalMinor`, not immutable original `RentalBooking.totalMinor`.

The staff direct-reschedule route derives a stable idempotency key from booking ID plus reviewed authority fingerprint and uses the shared safe inventory form parser. Exact replay returns the already-applied date change; reuse for different authority or dates is rejected. A successfully persisted pre-pickup reschedule can still replay after later pickup because replay does not create a new mutation.

For a supported price change, `prepareRentalBookingCommercialAmendment` reacquires booking/current-unit locks, uses database time, revalidates lifecycle/custody/inventory/current pricing, verifies the commercial review fingerprint, requires reconciled fully paid original booking-price evidence, and persists a short-lived `PREPARED` amendment. New original booking-price writes then freeze while amendment-owned settlement authority is active.

After exact retained adjustment evidence exists, `applyRentalBookingCommercialAmendment` re-locks and revalidates amendment status/expiry, booking version, custody shape, current allocation, target inventory, target pricing/fingerprint, original settlement, and exact uncompensated adjustment evidence. Only then does it append the linked terminal reschedule, move effective allocation dates, advance the booking version, and mark the amendment `APPLIED`.

## Database custody and commercial boundaries

The original fulfillment migration made pickup a hard boundary for all new reschedule inserts. The later custody-extension migration replaces only that reschedule trigger while leaving cancellation and physical-unit substitution hard-locked after pickup.

The active reschedule custody guard uses the same tenant/booking advisory lock namespace and independently enforces:

- returned bookings cannot receive a new reschedule/extension row;
- before pickup, the existing pre-pickup reschedule shape remains available;
- after pickup, the new row's source dates must equal the current effective dates;
- target start must remain the current effective start;
- target end must be strictly later than the current effective end;
- extension application time cannot predate retained pickup evidence.

Commercial guards independently prevent an ordinary reschedule while an amendment is `PREPARED`, permit only the exact linked final-apply reschedule for that amendment transaction, and after `APPLIED` require every later direct reschedule to preserve the amendment currency and exact `afterTotalMinor`. A second price-changing amendment remains blocked.

Existing reschedule insert/allocation guards still validate confirmed tenant ownership, source-chain continuity, effective money/pricing evidence, effective unit authority, operational availability, and deferred exact-allocation synchronization.

## Append-only evidence and effective allocation

Each successful direct or commercial-final-apply date mutation inserts one `rental_booking_reschedules` row containing source/target dates, effective accepted money, source/target pricing fingerprints, target pricing snapshot, authority fingerprint, idempotency key, and application timestamp.

The row is append-only. Database triggers reject update or delete. Only operational `RentalBookingAllocation` dates move. Original `RentalBooking` ownership, unit assignment, booking-time dates, and commercial evidence remain immutable.

Database guards derive the effective unit from latest substitution history and effective dates from latest reschedule history. Allocation writes reject unavailable blocks, effective holds, another live booking, or incompatible custody authority. A deferred constraint rejects a reschedule insert unless its target allocation is present before commit.

## Downstream fulfillment and late-return semantics

A later return derives the latest reschedule target dates, so custody evidence after an extension snapshots the extended committed period. Overdue-custody reads likewise use the latest effective end date. A post-return late-return assessment compares the actual return against that retained effective committed end rather than the original booking-time end.

A date change itself does not create or waive a late fee. Price-neutral writes do not move money. Commercial adjustment money is retained only through the separate amendment settlement/effective-settlement contracts.

## Staff interaction

The booking detail exposes `Reschedule rental` before pickup and `Extend rental` while picked up when the actor has the required review permissions. Returned bookings expose neither action.

The shared review page fixes the start date in custody-extension mode and accepts only a later end date. For every valid target it shows the accepted effective amount and fresh target amount; same-currency changes include the exact increase/decrease. UI restrictions are usability only; service and database rules remain authoritative.

For `UNCHANGED`, Apply is rendered only for a price-neutral ready review. For a supported first `PRICE_CHANGED` review, authorized staff receive the separate commercial preparation action rather than a direct Apply action. The browser submits target dates plus server-issued fingerprint, never authoritative money or amendment direction. An existing prepared/applied amendment links staff back to the retained workspace when payment-read authority permits.

Direct apply records a distinct `booking.rental.extended` audit action for the custody path and `booking.rental.rescheduled` before pickup. Commercial final apply retains its own amendment/reschedule audit evidence.

## Deliberate boundaries

This lifecycle does not implement unit-type changes, location-changing substitution, a second/chained price-changing amendment, partial/split provider-backed adjustment, automatic proration, delivery/one-way rules, customer self-service, or external fleet synchronization.

A target whose same-currency price changes the accepted effective aggregate amount is `PRICE_CHANGED`. The first supported price change must use the retained commercial-amendment workflow; it must never be forced through the direct price-neutral writer. A target whose current pricing currency differs from the accepted booking is `CURRENCY_CHANGED` and remains pricing-configuration drift. After one applied amendment, further price changes remain blocked until a separate chained-amendment contract exists.

See [rental-booking-reschedule-authority.md](./rental-booking-reschedule-authority.md), [rental-booking-commercial-amendments.md](./rental-booking-commercial-amendments.md), and [rental-booking-effective-settlement.md](./rental-booking-effective-settlement.md).

## Validation

- `src/server/bookings/rental-booking-reschedule-domain.test.ts` covers custody-extension shape, custody-bound authority fingerprints, and commercial-impact classification/delta math.
- `scripts/rental-booking-reschedule-source-contract.test.mjs` protects append-only persistence, effective-unit guards, tenant/permission boundaries, locks, custody modes, exact write scope, server-derived idempotency, staff direct-apply wiring, and immutable commercial evidence.
- `scripts/rental-booking-reschedule-commercial-review-source-contract.test.mjs` protects server-derived commercial impact, separate currency-drift blocking, exact staff review evidence, price-neutral direct apply separation, and supported commercial-amendment preparation handoff.
- `scripts/rental-booking-commercial-amendment-staff-orchestration-source-contract.test.mjs` protects the prepared settlement/compensation/final-apply staff flow.
- `scripts/rental-post-commercial-neutral-reschedule-source-contract.test.mjs` protects later direct date changes against the applied effective commercial total.
- `scripts/rental-booking-pre-custody-writer-source-contract.test.mjs` protects cancellation's hard custody boundary, custody-aware date-change writers, and idempotent replay behavior.
- `scripts/rental-booking-fulfillment-source-contract.test.mjs` protects the database transition from the original hard reschedule lock to the narrow custody-extension exception while cancellation and replacement remain locked after pickup.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
