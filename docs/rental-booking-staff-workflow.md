# Rental booking staff workflow

SF exposes a staff-facing interaction layer for the durable rental booking foundation. Staff can review an effective physical-unit hold against an active tenant customer, confirm the booking through the atomic writer, read paginated rental booking history/detail, apply supported same-unit price-neutral date reschedules, apply supported same-type/same-location physical-unit substitutions, record supported manual/offline settlement evidence, refund settled manual money, cancel a confirmed booking only after payment settlement is reconciled to zero, and record the supported pickup/return physical-custody lifecycle.

The workflow does not invent deposits, online payment collection, unit-type/location-changing amendments, price-changing amendments, delivery, early-return inventory release, late-return fees, inspection/damage processing, maintenance transitions, notifications, or external fulfillment integrations.

## Routes

- `/inventory/rentals/holds/[hold-id]` reviews one effective rental hold against an active tenant customer.
- `POST /api/inventory/rentals/holds/[hold-id]/confirm` derives tenant, actor, and confirmation idempotency authority from authenticated server context before calling `confirmRentalBookingFromHold`.
- `/inventory/rentals/bookings` is the tenant-scoped, paginated staff read model with lifecycle filtering and current effective allocation dates/unit.
- `/inventory/rentals/bookings/[booking-id]` renders immutable booking-time evidence, current effective allocation, append-only reschedule/substitution/fulfillment history, tenant-scoped manual settlement history, and cancellation evidence.
- `/inventory/rentals/bookings/[booking-id]/reschedule` reviews target dates and only renders Apply when fresh authority is ready and the actor can manage availability.
- `POST /api/inventory/rentals/bookings/[booking-id]/reschedule` derives tenant, actor, and idempotency authority server-side and calls the durable reschedule writer.
- `/inventory/rentals/bookings/[booking-id]/unit-substitution` searches bounded same-type/same-location candidate units and runs fresh target-inventory authority review. Apply is rendered only for ready authority plus availability-management permission.
- `POST /api/inventory/rentals/bookings/[booking-id]/unit-substitution` derives tenant, actor, and idempotency server-side and calls the durable substitution writer.
- `POST /api/inventory/rentals/bookings/[booking-id]/payments/manual` derives tenant, actor, exact accepted amount, and idempotency server-side. The form supplies only the real external offline payment reference.
- `POST /api/inventory/rentals/bookings/[booking-id]/payments/refunds` derives tenant, actor, refund source/amount, and idempotency server-side. The form supplies only the real external refund reference.
- `POST /api/inventory/rentals/bookings/[booking-id]/cancel` derives tenant and actor server-side and calls the terminal cancellation writer, which refuses to release inventory while settled money remains or after pickup has transferred custody.
- `POST /api/inventory/rentals/bookings/[booking-id]/pickup` derives tenant, actor, effective unit/date evidence, event time, and idempotency server-side before appending pickup custody evidence.
- `POST /api/inventory/rentals/bookings/[booking-id]/return` derives the same authority server-side and appends return evidence only after pickup.

All routes remain inside the authenticated SF application shell. No public/customer rental booking, payment, modification, pickup, or return route is introduced.

## Authorization and tenant scope

Rental booking list/detail reads require `booking:read`; every booking query repeats the authenticated `organizationId`.

Hold conversion review requires `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `customer:read`; confirmation additionally requires `availability:manage`.

Reschedule review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Apply additionally requires `availability:manage`.

Replacement-unit candidate search requires `booking:manage` plus `inventory:read`; fresh substitution authority review additionally requires `availability:read`; apply additionally requires `availability:manage`. Candidate IDs never grant ownership authority.

Rental payment history requires `payment:read`. Manual payment/refund recording requires `payment:manage`; service queries always repeat tenant scope and use the same rental booking lock as lifecycle writers.

Cancellation requires `booking:manage` plus `availability:manage` and independently rechecks the tenant booking, current effective allocation, complete rental payment history, and pre-pickup lifecycle inside its serializable transaction/database guard boundary.

Pickup and return require both `booking:manage` and `inventory:manage`. The fulfillment writer repeats tenant scope, resolves the current effective allocation after reschedules/substitutions, and never trusts browser-supplied unit, date, timestamp, or idempotency authority.

UI permission checks are usability only. Review and write services independently enforce server-side permissions and tenant ownership.

## Confirmation authority

The browser-visible conversion review is never write authority. Confirmation reacquires the idempotency and physical-unit locks, uses PostgreSQL time, revalidates active tenant customer/hold/unit/location state, checks inventory and current pricing, compares the conversion fingerprint, consumes the hold, creates the durable booking/allocation, and writes an audit event atomically.

## Reschedule authority

Rental rescheduling is intentionally narrow: the current effective physical unit, retained unit type, and retained location do not change; accepted currency and aggregate amount do not change; original booking-time commercial evidence stays immutable; and current target inventory/pricing are rebuilt at review and again under write locks.

Successful apply inserts append-only reschedule evidence, moves only effective allocation dates, advances the booking version, and writes an audit event. Database guards derive the effective unit from substitution history and require the current allocation to match both latest date and unit authority. New reschedules fail closed after pickup custody evidence exists.

See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

## Physical-unit substitution authority

Physical-unit substitution is intentionally narrow: source and target are active tenant units with the same retained unit type and operating location; current effective dates do not change; accepted currency/amount and effective pricing fingerprint do not change.

Candidate discovery is bounded to 50 rows and is not availability authority. Fresh review checks target blocks, effective holds, and other non-cancelled allocations using PostgreSQL time. A ready version-2 fingerprint binds the tenant, booking version, current source unit, requested target unit, retained type/location, current dates, exact accepted money, and effective pricing evidence.

`applyRentalBookingUnitSubstitution` takes the booking lock, then source and target physical-unit locks in deterministic order. It revalidates the current source allocation, target inventory, lifecycle/type/location constraints, and reviewed fingerprint before inserting append-only substitution evidence and moving only the effective allocation unit. Immutable booking-time `RentalBooking.unitId` remains unchanged. New substitutions fail closed after pickup custody evidence exists.

Server-derived idempotency replay succeeds only while the same substitution remains the latest/current physical assignment. Older substitution replays after another replacement fail closed.

See [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md).

## Payment settlement authority

The supported payment boundary is staff-recorded manual/offline evidence only. Full payment derives the exact authoritative amount from `RentalBooking`; refund derives the current refundable source and remaining amount from the complete transaction history. Browser forms cannot submit amount, tenant identity, actor identity, or idempotency authority.

`RentalPaymentTransaction` retains tenant-owned payment/refund evidence. The staff detail derives `UNPAID`, `PAID`, `PARTIALLY_REFUNDED`, or `REFUNDED` from transaction history instead of mutating immutable rental booking commercial evidence.

Cancellation is withheld in the UI until settlement is readable, reconciled, and net zero. The cancellation service and database guard independently enforce this rule.

See [rental-payment-foundation.md](./rental-payment-foundation.md).

## Cancellation authority

Cancellation is an inventory-release lifecycle mutation, not a refund action. It uses the same tenant/booking lock namespace plus the **current effective physical-unit lock**, validates the current allocation after any reschedule/substitution, and changes only a still-matching `CONFIRMED` record to terminal `CANCELLED` after rental payment history reconciles to zero.

Cancellation is pre-pickup only. The fulfillment database guard uses the same tenant/booking lock namespace and rejects cancellation once custody evidence exists, including direct database writes that bypass the application service.

The allocation and append-only reschedule/substitution/payment rows remain retained as historical evidence. Rental inventory queries ignore allocations whose parent booking is cancelled, so inventory is released only after cancellation commits. Repeated cancellation is idempotent.

## Fulfillment authority

The supported physical-custody state machine is `AWAITING_PICKUP -> PICKED_UP -> RETURNED`. Pickup and return are append-only tenant-owned evidence, not mutable booking status values.

Pickup/return writers lock the tenant booking and current effective physical unit, validate the exact allocation after any prior reschedule/substitution, require the current unit to remain active at the retained booking assignment, use PostgreSQL `clock_timestamp()`, derive idempotency server-side, and write secret-free audit evidence atomically.

Pickup is the custody handoff boundary. Once pickup exists, cancellation, rescheduling, and physical-unit substitution are blocked at both UI and database boundaries. Return requires prior pickup and cannot predate it. Return does not release or shorten the booking allocation before the effective end date.

See [rental-booking-fulfillment-foundation.md](./rental-booking-fulfillment-foundation.md).

## Read model

`listRentalBookings` requires `booking:read`, enforces tenant scope, caps page size at 100, and supports `ALL`, `CONFIRMED`, and `CANCELLED` lifecycle filters. Staff see the current effective allocation dates and physical unit rather than stale booking-time values after supported mutations.

`getRentalBooking` resolves one tenant booking plus append-only reschedule, substitution, and fulfillment history. Detail distinguishes immutable booking-time unit/dates/customer/commercial evidence from current effective allocation, physical-custody evidence, and terminal cancellation evidence. A missing or inconsistent allocation remains an integrity incident.

`listRentalBookingPaymentTransactions` separately requires `payment:read`, caps display pagination at 100, and reconciles payment state from the complete tenant-owned history rather than only the visible page.

## Deliberate boundaries

This workflow does not implement or imply deposits/card authorization, Stripe rental checkout, public payment collection, split/tendered settlement, unit-type changes, location-changing substitutions, price-changing reschedules/amendments, cancellation fees, customer pickup/drop-off location selection, delivery, early-return inventory release, late-return handling/fees, inspection/damage/security-bond processing, maintenance transitions, public self-service, notifications, invoices, or external synchronization.

Those features require separate commercial state machines and acceptance criteria. No dead primary action is exposed for them.

## Validation

`scripts/rental-booking-staff-workflow-source-contract.test.mjs` protects tenant-scoped reads, server-derived mutation authority, staff list/detail routes, cancellation/reschedule/substitution wiring, and unsupported downstream workflow boundaries.

`scripts/rental-booking-unit-substitution-lifecycle-source-contract.test.mjs` protects append-only substitution persistence, effective-unit database authority, deterministic locking, idempotency, neighboring mutation compatibility, and route scope.

`scripts/rental-payment-foundation-source-contract.test.mjs` protects the rental settlement schema/migration, tenant scope, booking-lock serialization, provider-adapter use, payment/refund route authority, and cancellation financial guard.

`scripts/rental-booking-fulfillment-source-contract.test.mjs` protects append-only custody persistence, tenant scope, booking/effective-unit locks, server-derived timestamps/idempotency, pickup-before-return ordering, neighboring lifecycle freeze after pickup, and staff route authority.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
