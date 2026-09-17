# Rental booking staff workflow

SF exposes a staff-facing interaction layer for the durable rental booking foundation. Staff can review an effective physical-unit hold against an active tenant customer, confirm the booking through the atomic writer, read paginated rental booking history/detail, apply supported same-unit price-neutral date reschedules, apply supported same-type/same-location physical-unit substitutions, record supported manual/offline settlement evidence, refund settled manual money, cancel a confirmed booking only after payment settlement is reconciled to zero, record the supported pickup/return physical-custody lifecycle, explicitly release complete remaining rental days after an early return, record one append-only condition inspection after return, and manage an explicit operational damage case after a non-clear inspection.

The workflow does not invent deposits, public/online rental payment collection, unit-type/location-changing amendments, price-changing amendments, delivery, late-return fees, customer damage liability/charging, security-bond settlement, notifications, or external fulfillment integrations.

## Routes

- `/inventory/rentals/holds/[hold-id]` reviews one effective rental hold against an active tenant customer.
- `POST /api/inventory/rentals/holds/[hold-id]/confirm` derives tenant, actor, and confirmation idempotency authority from authenticated server context before calling `confirmRentalBookingFromHold`.
- `/inventory/rentals/bookings` is the tenant-scoped, paginated staff read model with lifecycle filtering, committed dates, current effective unit, current fulfillment state, overdue-custody/missed-pickup operational queues, and any early-return inventory-release indicator.
- `/inventory/rentals/bookings/[booking-id]` renders immutable booking-time evidence, committed dates, current live inventory protection, append-only reschedule/substitution/fulfillment/early-return-release history, tenant-scoped manual settlement history, cancellation evidence, retained return-inspection evidence, and retained damage-case evidence when present.
- `/inventory/rentals/bookings/[booking-id]/reschedule` reviews target dates and only renders Apply when fresh authority is ready and the actor can manage availability.
- `POST /api/inventory/rentals/bookings/[booking-id]/reschedule` derives tenant, actor, and idempotency authority server-side and calls the durable reschedule writer.
- `/inventory/rentals/bookings/[booking-id]/unit-substitution` searches bounded same-type/same-location candidate units and runs fresh target-inventory authority review only before custody transfer and before the exclusive committed pickup end. Apply is rendered only for ready authority plus availability-management permission.
- `POST /api/inventory/rentals/bookings/[booking-id]/unit-substitution` derives tenant, actor, and idempotency server-side and calls the durable substitution writer, which rechecks fulfillment and pickup-window authority under locks.
- `POST /api/inventory/rentals/bookings/[booking-id]/payments/manual` derives tenant, actor, exact accepted amount, and idempotency server-side. The form supplies only the real external offline payment reference.
- `POST /api/inventory/rentals/bookings/[booking-id]/payments/refunds` derives tenant, actor, refund source/amount, and idempotency server-side. The form supplies only the real external refund reference.
- `POST /api/inventory/rentals/bookings/[booking-id]/cancel` derives tenant and actor server-side and calls the terminal cancellation writer, which refuses to release inventory while settled money remains or after pickup has transferred custody.
- `POST /api/inventory/rentals/bookings/[booking-id]/pickup` derives tenant, actor, effective unit/date evidence, event time, and idempotency server-side before appending pickup custody evidence.
- `POST /api/inventory/rentals/bookings/[booking-id]/return` derives the same authority server-side and appends return evidence only after pickup.
- `POST /api/inventory/rentals/bookings/[booking-id]/inventory-release` derives tenant, actor, exact return evidence, retained booking-location calendar, release cutoff, and idempotency server-side before shortening only live inventory protection.
- `POST /api/inventory/rentals/bookings/[booking-id]/return-inspection` derives tenant and actor from authenticated context, accepts only condition outcome/notes, derives deterministic idempotency server-side, and binds the write to retained `RETURNED` custody evidence.
- `POST /api/inventory/rentals/bookings/[booking-id]/damage-case` derives tenant/actor and deterministic case idempotency server-side, accepts only a required operational summary, and binds the case to retained non-clear inspection evidence.
- `POST /api/inventory/rentals/bookings/[booking-id]/damage-case/[case-id]` performs only supported assess/waive/close transitions. Assessment accepts exact repair-estimate input and notes; waiver/closure accept retained reason evidence. None of these actions changes customer settlement.

All routes remain inside the authenticated SF application shell. No public/customer rental booking, payment, modification, pickup, return, inventory-release, inspection, or damage-case route is introduced.

## Authorization and tenant scope

Rental booking list/detail reads require `booking:read`; every booking query repeats the authenticated `organizationId`.

Hold conversion review requires `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `customer:read`; confirmation additionally requires `availability:manage`.

Reschedule review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Apply additionally requires `availability:manage`.

Replacement-unit candidate search requires `booking:manage` plus `inventory:read`; fresh substitution authority review additionally requires `availability:read`; apply additionally requires `availability:manage`. Candidate IDs never grant ownership authority.

Rental payment history requires `payment:read`. Manual payment/refund recording requires `payment:manage`; service queries always repeat tenant scope and use the same rental booking lock as lifecycle writers.

Cancellation requires `booking:manage` plus `availability:manage` and independently rechecks the tenant booking, current effective allocation, complete rental payment history, and pre-pickup lifecycle inside its serializable transaction/database guard boundary.

Pickup, return, early-return inventory release, return-inspection recording, and damage-case writes require both `booking:manage` and `inventory:manage`. The fulfillment/release/inspection/damage writers repeat tenant scope and never trust browser-supplied tenant, actor, unit, custody timestamp, or booking authority. Return-inspection and damage-case reads require `booking:read`.

UI permission checks are usability only. Review and write services independently enforce server-side permissions and tenant ownership.

## Confirmation authority

The browser-visible conversion review is never write authority. Confirmation reacquires the idempotency and physical-unit locks, uses PostgreSQL time, revalidates active tenant customer/hold/unit/location state, checks inventory and current pricing, compares the conversion fingerprint, consumes the hold, creates the durable booking/allocation, and writes an audit event atomically.

## Reschedule authority

Rental rescheduling is intentionally narrow: the current effective physical unit, retained unit type, and retained location do not change; accepted currency and aggregate amount do not change; original booking-time commercial evidence stays immutable; and current target inventory/pricing are rebuilt at review and again under write locks.

Successful apply inserts append-only reschedule evidence, moves only effective allocation dates, advances the booking version, and writes an audit event. Database guards derive the effective unit from substitution history and require the current allocation to match both latest date and unit authority. New reschedules fail closed after pickup custody evidence exists.

See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

## Physical-unit substitution authority

Physical-unit substitution is intentionally narrow: source and target are active tenant units with the same retained unit type and operating location; current effective dates do not change; accepted currency/amount and effective pricing fingerprint do not change.

Candidate discovery is bounded to 50 rows and is not availability authority. Fresh review checks the current effective pickup window using PostgreSQL time plus the retained location timezone before checking target blocks, effective holds, overdue open custody, and other non-cancelled allocations. Once the exclusive effective end date has been reached without pickup, the booking is a missed pickup and candidate/review authority closes instead of permitting a replacement under an expired period.

`applyRentalBookingUnitSubstitution` takes the booking lock, then source and target physical-unit locks in deterministic order. It revalidates the absence of fulfillment evidence, retained location timezone, current source allocation, target inventory, lifecycle/type/location constraints, and reviewed fingerprint before inserting append-only substitution evidence and moving only the effective allocation unit. Immutable booking-time `RentalBooking.unitId` remains unchanged.

See [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md) and [rental-booking-pickup-window.md](./rental-booking-pickup-window.md).

## Payment settlement authority

The supported payment boundary is staff-recorded manual/offline evidence only. Full payment derives the exact authoritative amount from `RentalBooking`; refund derives the current refundable source and remaining amount from the complete transaction history. Browser forms cannot submit amount, tenant identity, actor identity, or idempotency authority.

`RentalPaymentTransaction` retains tenant-owned payment/refund evidence. The staff detail derives `UNPAID`, `PAID`, `PARTIALLY_REFUNDED`, or `REFUNDED` from transaction history instead of mutating immutable rental booking commercial evidence.

Cancellation is withheld in the UI until settlement is readable, reconciled, and net zero. The cancellation service and database guard independently enforce this rule.

See [rental-payment-foundation.md](./rental-payment-foundation.md).

## Cancellation authority

Cancellation is an inventory-release lifecycle mutation, not a refund action. It uses the same tenant/booking lock namespace plus the current effective physical-unit lock, validates the current allocation after any reschedule/substitution, and changes only a still-matching `CONFIRMED` record to terminal `CANCELLED` after rental payment history reconciles to zero.

Cancellation is pre-pickup only. The fulfillment database guard uses the same tenant/booking lock namespace and rejects cancellation once custody evidence exists, including direct database writes that bypass the application service.

## Fulfillment, inventory release, return inspection, and damage-case authority

The supported physical-custody state machine is `AWAITING_PICKUP -> PICKED_UP -> RETURNED`. Pickup and return are append-only tenant-owned evidence, not mutable booking status values.

Pickup/return writers lock the tenant booking and current effective physical unit, validate the exact allocation after any prior reschedule/substitution, require the current unit to remain active at the retained booking assignment, use PostgreSQL `clock_timestamp()`, derive idempotency server-side, and write secret-free audit evidence atomically.

Pickup is the custody handoff boundary. Once pickup exists, cancellation, rescheduling, and physical-unit substitution are blocked at both UI and database boundaries. Return requires prior pickup and cannot predate it. Return does not automatically shorten the booking allocation.

After return, `releaseRentalBookingInventoryAfterEarlyReturn` can shorten only live inventory protection for complete remaining rental days. Separately, `recordRentalReturnInspection` records one append-only condition outcome against the exact `RETURNED` event and returned unit. Non-clear outcomes require notes and move an available unit to `OUT_OF_SERVICE` before inspection evidence is inserted. PostgreSQL independently requires the same returned-custody binding and operational quarantine. The inspection does not create customer liability or change accepted money.

A retained non-clear inspection can feed one `RentalDamageCase`. Opening the case uses deterministic server idempotency and the shared physical-unit lock; `OPEN` and `ASSESSED` cases keep the unit unavailable and unarchivable. Assessment stores an exact repair estimate in the retained booking currency. The estimate is operational evidence only: it does not create customer liability, an amount due, payment/refund authority, or a security-bond decision. Waiver and closure are explicit terminal transitions and do not automatically return the unit to service.

See [rental-booking-fulfillment-foundation.md](./rental-booking-fulfillment-foundation.md), [rental-early-return-inventory-release.md](./rental-early-return-inventory-release.md), [rental-return-inspection.md](./rental-return-inspection.md), and [rental-damage-case.md](./rental-damage-case.md).

## Read model

`listRentalBookings` requires `booking:read`, enforces tenant scope, caps page size at 100, and supports lifecycle filters plus overdue-custody and missed-pickup operational queues.

`getRentalBooking` resolves one tenant booking plus bounded append-only reschedule, substitution, fulfillment, and early-return release evidence. Return-inspection and damage-case evidence are read through dedicated tenant-scoped read services and shown on booking detail after return when applicable.

`listRentalBookingPaymentTransactions` separately requires `payment:read`, caps display pagination at 100, and reconciles payment state from the complete tenant-owned history rather than only the visible page.

## Deliberate boundaries

This workflow does not implement or imply deposits/card authorization, Stripe rental checkout, public payment collection, split/tendered settlement, unit-type changes, location-changing substitutions, price-changing reschedules/amendments, cancellation fees, customer pickup/drop-off location selection, delivery, late-return fees, customer damage liability/charging, repair-cost settlement/adjudication, security-bond capture/release/forfeit, automatic maintenance creation from inspection/damage case, public self-service, notifications, invoices, or external synchronization.

Those features require separate commercial state machines and acceptance criteria. No dead primary action is exposed for them.

## Validation

Existing rental staff-workflow, substitution, payment, fulfillment, and early-return source contracts continue to protect their respective boundaries.

`scripts/rental-return-inspection-source-contract.test.mjs` protects append-only tenant inspection persistence, exact returned-custody binding, dual write authorization, physical-unit locking, non-clear operational quarantine, PostgreSQL-authored immutable evidence, and the real booking-detail action.

`scripts/rental-damage-case-source-contract.test.mjs` protects deterministic case authority, tenant/source binding, exact estimate evidence, unresolved-case operational guards, lifecycle immutability, real staff actions, and the deliberate no-charge/no-liability boundary.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
