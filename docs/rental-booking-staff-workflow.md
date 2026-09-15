# Rental booking staff workflow

SF exposes a staff-facing interaction layer for the durable rental booking foundation. Staff can review an effective physical-unit hold against an active tenant customer, confirm the booking through the atomic writer, read paginated rental booking history/detail, apply supported same-unit price-neutral date reschedules, cancel a confirmed booking to release its physical inventory, and run a read-only same-type/same-location replacement-unit preflight.

The workflow does not invent payment, deposit, durable unit-substitution, price-changing amendment, pickup, delivery, return, or fulfillment semantics.

## Routes

- `/inventory/rentals/holds/[hold-id]` reviews one effective rental hold against an active tenant customer.
- `POST /api/inventory/rentals/holds/[hold-id]/confirm` derives tenant, actor, and confirmation idempotency authority from authenticated server context before calling `confirmRentalBookingFromHold`.
- `/inventory/rentals/bookings` is the tenant-scoped, paginated staff read model with lifecycle filtering and current effective allocation dates. Confirmed rows expose the replacement-unit review only when the actor has the required review permissions.
- `/inventory/rentals/bookings/[booking-id]` renders immutable booking-time evidence, current effective allocation, append-only reschedule history, and cancellation evidence.
- `/inventory/rentals/bookings/[booking-id]/reschedule` reviews target dates and only renders Apply when fresh authority is ready and the actor can manage availability.
- `POST /api/inventory/rentals/bookings/[booking-id]/reschedule` derives tenant, actor, and idempotency authority server-side and calls the durable reschedule writer.
- `POST /api/inventory/rentals/bookings/[booking-id]/cancel` derives tenant and actor server-side and calls the terminal cancellation writer.
- `/inventory/rentals/bookings/[booking-id]/unit-substitution` searches bounded same-type/same-location candidate units and runs a fresh read-only inventory-authority review. It has no POST route or Apply action.

All routes remain inside the authenticated SF application shell. No public/customer rental booking or modification route is introduced.

## Authorization and tenant scope

Rental booking list/detail reads require `booking:read`; every booking query repeats the authenticated `organizationId`.

Hold conversion review requires `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `customer:read`; confirmation additionally requires `availability:manage`.

Reschedule review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Apply additionally requires `availability:manage`. These UI checks are usability only: both review and write services independently enforce server-side permissions and tenant ownership.

Replacement-unit candidate search requires `booking:manage` plus `inventory:read`; fresh substitution authority review additionally requires `availability:read`. The candidate and review services independently repeat tenant scope and never treat a browser-supplied unit ID as ownership authority.

Cancellation requires `booking:manage` plus `availability:manage` and independently rechecks the tenant booking and current effective allocation inside its serializable transaction.

## Confirmation authority

The browser-visible conversion review is never write authority. Confirmation reacquires the idempotency and physical-unit locks, uses PostgreSQL time, revalidates active tenant customer/hold/unit/location state, checks inventory and current pricing, compares the conversion fingerprint, consumes the hold, creates the durable booking/allocation, and writes an audit event atomically.

## Reschedule authority

Rental rescheduling is intentionally narrow: the physical unit, unit type, and location do not change; the accepted currency and aggregate amount do not change; original booking-time commercial evidence stays immutable; and current target inventory and pricing are rebuilt at review and again under write locks.

The review returns a versioned authority fingerprint binding the current booking version, effective source dates, target dates, physical assignment, exact money, source pricing fingerprint, and target pricing fingerprint.

The POST route accepts only target dates plus that reviewed fingerprint. Tenant and actor come from authenticated server context. The route derives a stable idempotency key from booking plus authority; it never trusts browser-supplied organization, actor, unit, money, pricing snapshot, or idempotency authority.

Successful apply inserts append-only reschedule evidence, moves only the effective physical allocation dates, advances the booking version, and writes an audit event. Database guards require the live allocation to match the latest reschedule target and continue rejecting unavailable blocks, active holds, or other live bookings.

See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

## Replacement-unit authority

The replacement-unit preflight is deliberately narrower than a complete unit-substitution workflow. It allows staff to search up to 50 active physical units at a time by name/code, but only within the booking's retained unit type and operating location. Candidate discovery does not imply availability.

Fresh review uses PostgreSQL time and the booking's current effective allocation dates, including the latest append-only reschedule target when present. It rejects inactive/wrong-tenant/wrong-type/wrong-location targets and target units blocked by unavailable dates, effective holds, or another non-cancelled allocation.

A ready review returns a deterministic authority fingerprint binding the tenant, booking version, source/target units, retained type/location, effective dates, accepted money, and effective pricing fingerprint. It reserves nothing and persists nothing.

There is intentionally no substitution POST route or Apply button yet. The durable writer requires append-only substitution evidence, deterministic booking/source/target unit locking, idempotency, stale-authority rejection, audit evidence, and database allocation guards that derive the current effective unit without rewriting immutable booking-time unit evidence. See [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md).

## Cancellation authority

Cancellation is an inventory-release lifecycle mutation, not a financial action. It uses the same tenant/booking lock namespace as rescheduling plus the shared physical-unit lock, validates the current effective allocation, and changes only a still-matching `CONFIRMED` record to terminal `CANCELLED`.

The allocation and all reschedule rows remain retained as historical evidence. Existing rental inventory queries ignore allocations whose parent booking is cancelled, so the effective physical unit/date range is released only after cancellation commits. Repeated cancellation is idempotent.

## Read model

`listRentalBookings` requires `booking:read`, enforces tenant scope, caps page size at 100, and supports `ALL`, `CONFIRMED`, and `CANCELLED` lifecycle filters. Staff see current effective allocation dates rather than stale booking-time dates after a reschedule.

`getRentalBooking` resolves one tenant booking and its append-only reschedule history. The detail distinguishes immutable booking-time dates/customer/commercial snapshot, current effective allocation, applied reschedule history, and terminal cancellation evidence. A missing allocation remains an integrity incident.

## Deliberate boundaries

This workflow does not implement or imply rental payment collection/payment status, deposits/card authorization, durable physical-unit substitution/location change, price-changing reschedules/amendments, cancellation financial side effects, pickup/delivery/return/inspection/damage lifecycle, public self-service, notifications, or external synchronization.

The replacement-unit route is review infrastructure only. It does not make physical-unit substitution an implemented booking capability.

The remaining features require separate commercial state machines and acceptance criteria. No dead primary action is exposed for them.

## Validation

`scripts/rental-booking-staff-workflow-source-contract.test.mjs` protects tenant-scoped reads, server-derived confirmation authority, staff list/detail routes, cancellation wiring, durable reschedule wiring, and the explicit no-fake-payment/fulfillment boundary.

`scripts/rental-booking-reschedule-source-contract.test.mjs` protects the reschedule persistence and write boundary.

`scripts/rental-booking-unit-substitution-authority-source-contract.test.mjs` protects bounded tenant-scoped candidate search, fresh target-inventory review, deterministic authority evidence, and the deliberate absence of a substitution mutation.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
