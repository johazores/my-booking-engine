# Rental booking staff workflow

SF exposes a staff-facing interaction layer for the durable rental booking foundation. Staff can review an effective physical-unit hold against an active tenant customer, confirm the booking through the atomic writer, read paginated rental booking history/detail, apply supported same-unit price-neutral date reschedules, apply supported same-type/same-location physical-unit substitutions, and cancel a confirmed booking to release its physical inventory.

The workflow does not invent payment, deposit, unit-type/location-changing amendments, price-changing amendment, pickup, delivery, return, or fulfillment semantics.

## Routes

- `/inventory/rentals/holds/[hold-id]` reviews one effective rental hold against an active tenant customer.
- `POST /api/inventory/rentals/holds/[hold-id]/confirm` derives tenant, actor, and confirmation idempotency authority from authenticated server context before calling `confirmRentalBookingFromHold`.
- `/inventory/rentals/bookings` is the tenant-scoped, paginated staff read model with lifecycle filtering and current effective allocation dates/unit.
- `/inventory/rentals/bookings/[booking-id]` renders immutable booking-time evidence, current effective allocation, append-only reschedule/substitution history, and cancellation evidence.
- `/inventory/rentals/bookings/[booking-id]/reschedule` reviews target dates and only renders Apply when fresh authority is ready and the actor can manage availability.
- `POST /api/inventory/rentals/bookings/[booking-id]/reschedule` derives tenant, actor, and idempotency authority server-side and calls the durable reschedule writer.
- `/inventory/rentals/bookings/[booking-id]/unit-substitution` searches bounded same-type/same-location candidate units and runs fresh target-inventory authority review. Apply is rendered only for ready authority plus availability-management permission.
- `POST /api/inventory/rentals/bookings/[booking-id]/unit-substitution` derives tenant, actor, and idempotency server-side and calls the durable substitution writer.
- `POST /api/inventory/rentals/bookings/[booking-id]/cancel` derives tenant and actor server-side and calls the terminal cancellation writer.

All routes remain inside the authenticated SF application shell. No public/customer rental booking or modification route is introduced.

## Authorization and tenant scope

Rental booking list/detail reads require `booking:read`; every booking query repeats the authenticated `organizationId`.

Hold conversion review requires `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `customer:read`; confirmation additionally requires `availability:manage`.

Reschedule review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Apply additionally requires `availability:manage`.

Replacement-unit candidate search requires `booking:manage` plus `inventory:read`; fresh substitution authority review additionally requires `availability:read`; apply additionally requires `availability:manage`. Candidate IDs never grant ownership authority.

Cancellation requires `booking:manage` plus `availability:manage` and independently rechecks the tenant booking and current effective allocation inside its serializable transaction.

UI permission checks are usability only. Review and write services independently enforce server-side permissions and tenant ownership.

## Confirmation authority

The browser-visible conversion review is never write authority. Confirmation reacquires the idempotency and physical-unit locks, uses PostgreSQL time, revalidates active tenant customer/hold/unit/location state, checks inventory and current pricing, compares the conversion fingerprint, consumes the hold, creates the durable booking/allocation, and writes an audit event atomically.

## Reschedule authority

Rental rescheduling is intentionally narrow: the current effective physical unit, retained unit type, and retained location do not change; accepted currency and aggregate amount do not change; original booking-time commercial evidence stays immutable; and current target inventory/pricing are rebuilt at review and again under write locks.

Successful apply inserts append-only reschedule evidence, moves only effective allocation dates, advances the booking version, and writes an audit event. Database guards derive the effective unit from substitution history and require the current allocation to match both latest date and unit authority.

See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

## Physical-unit substitution authority

Physical-unit substitution is intentionally narrow: source and target are active tenant units with the same retained unit type and operating location; current effective dates do not change; accepted currency/amount and effective pricing fingerprint do not change.

Candidate discovery is bounded to 50 rows and is not availability authority. Fresh review checks target blocks, effective holds, and other non-cancelled allocations using PostgreSQL time. A ready version-2 fingerprint binds the tenant, booking version, current source unit, requested target unit, retained type/location, current dates, exact accepted money, and effective pricing evidence.

`applyRentalBookingUnitSubstitution` takes the booking lock, then source and target physical-unit locks in deterministic order. It revalidates the current source allocation, target inventory, lifecycle/type/location constraints, and reviewed fingerprint before inserting append-only substitution evidence and moving only the effective allocation unit. Immutable booking-time `RentalBooking.unitId` remains unchanged.

Server-derived idempotency replay succeeds only while the same substitution remains the latest/current physical assignment. Older substitution replays after another replacement fail closed.

See [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md).

## Cancellation authority

Cancellation is an inventory-release lifecycle mutation, not a financial action. It uses the same tenant/booking lock namespace plus the **current effective physical-unit lock**, validates the current allocation after any reschedule/substitution, and changes only a still-matching `CONFIRMED` record to terminal `CANCELLED`.

The allocation and append-only reschedule/substitution rows remain retained as historical evidence. Rental inventory queries ignore allocations whose parent booking is cancelled, so inventory is released only after cancellation commits. Repeated cancellation is idempotent.

## Read model

`listRentalBookings` requires `booking:read`, enforces tenant scope, caps page size at 100, and supports `ALL`, `CONFIRMED`, and `CANCELLED` lifecycle filters. Staff see the current effective allocation dates and physical unit rather than stale booking-time values after supported mutations.

`getRentalBooking` resolves one tenant booking plus append-only reschedule and substitution history. Detail distinguishes immutable booking-time unit/dates/customer/commercial evidence from current effective allocation and terminal cancellation evidence. A missing or inconsistent allocation remains an integrity incident.

## Deliberate boundaries

This workflow does not implement or imply rental payment collection/payment status, deposits/card authorization, unit-type changes, location-changing substitutions, price-changing reschedules/amendments, cancellation financial side effects, pickup/delivery/return/inspection/damage lifecycle, public self-service, notifications, or external synchronization.

Those features require separate commercial state machines and acceptance criteria. No dead primary action is exposed for them.

## Validation

`scripts/rental-booking-staff-workflow-source-contract.test.mjs` protects tenant-scoped reads, server-derived mutation authority, staff list/detail routes, cancellation/reschedule/substitution wiring, and the no-fake-payment/fulfillment boundary.

`scripts/rental-booking-unit-substitution-lifecycle-source-contract.test.mjs` protects append-only substitution persistence, effective-unit database authority, deterministic locking, idempotency, neighboring mutation compatibility, and route scope.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
