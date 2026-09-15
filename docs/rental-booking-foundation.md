# Rental booking foundation

SF has a durable rental booking persistence and staff lifecycle boundary. It converts one active physical-unit hold into one confirmed tenant booking, exposes tenant-scoped staff history/detail, supports same-unit price-neutral date rescheduling through append-only evidence, and supports terminal cancellation that releases live inventory while retaining history.

The commercial contract remains intentionally narrow: it establishes ownership, immutable booking-time customer/commercial evidence, effective physical-unit allocation, idempotency, inventory protection/release, reschedule authority, auditability, and staff review without inventing payment/deposit, unit substitution, price-changing amendment, pickup/delivery/return, fulfillment, or customer self-service behavior.

## Durable records

`RentalBooking` stores tenant/customer identity, immutable customer snapshot, source hold, physical unit/type/location, confirmation idempotency key, lifecycle, original booking-time dates, currency, exact accepted total, immutable pricing evidence, conversion-authority fingerprint, and confirmation/cancellation timestamps.

`RentalBookingAllocation` is the current physical inventory commitment. It binds one booking to one tenant-owned unit and the current effective date range. Cancellation retains the allocation as historical evidence; inventory guards treat it as non-blocking once the parent booking is `CANCELLED`.

`RentalBookingReschedule` is append-only evidence for a supported same-unit, price-neutral date change. It stores effective source/target dates, unchanged money, source/target pricing fingerprints, target pricing snapshot, reviewed authority fingerprint, stable idempotency key, and application timestamp. The original `RentalBooking` commercial/date evidence is not rewritten.

The rental booking/customer relationship is modeled in Prisma and backed by a composite tenant foreign key. Rental reschedule rows are likewise modeled with a composite booking relationship and database foreign key.

## Confirmation writer

`confirmRentalBookingFromHold` is server-only and requires `booking:manage`, `availability:manage`, `inventory:read`, `pricing:read`, and `customer:read`.

It runs in a serializable transaction under tenant/idempotency and tenant/physical-unit locks, uses PostgreSQL time, and revalidates active hold/customer/unit/type/location, unavailable blocks, effective holds, live booking allocations, complete hold pricing evidence, current pricing, and the exact conversion authority.

Only after exact hold consumption does the transaction create booking, allocation, and audit evidence. Replay succeeds only for the same tenant-local hold/customer/authority identity.

## Reschedule lifecycle

Same-unit, price-neutral rescheduling is documented in [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

Review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Apply additionally requires `availability:manage`.

Review is read-only and derives the current effective source period from the retained allocation/latest append-only reschedule rather than assuming original booking dates are still current. It rejects unavailable blocks, effective holds, other live allocations, no-op dates, and any target pricing whose currency or exact aggregate amount differs.

Apply reacquires a shared tenant/booking lock plus the physical-unit lock, rebuilds authority, derives idempotency server-side, inserts append-only reschedule evidence, changes only effective allocation dates, advances booking `updatedAt` for stale-authority invalidation, and records an audit event. Database constraints require the target allocation before commit.

## Cancellation lifecycle

`cancelRentalBooking` requires `booking:manage` and `availability:manage`, runs in a serializable transaction under the same tenant/booking and physical-unit locks, and validates the current effective allocation including any latest reschedule target.

The final `CONFIRMED -> CANCELLED` write remains an exact compare-and-swap over immutable booking evidence plus observed version. The allocation and reschedule history remain retained. Live inventory guards ignore the retained allocation only after the parent booking is cancelled.

See [rental-booking-cancellation.md](./rental-booking-cancellation.md).

## Staff booking interaction

The authenticated hold detail supports bounded active-customer search, conversion review, and confirmation only after ready server authority.

`/inventory/rentals/bookings` and `/inventory/rentals/bookings/[booking-id]` provide `booking:read`-protected tenant history/detail. List/detail show current effective allocation dates; detail separately preserves original booking-time dates, append-only reschedule history, accepted money, customer snapshot, source evidence, and cancellation evidence.

`/inventory/rentals/bookings/[booking-id]/reschedule` provides a fresh GET review and a POST Apply action only when the review is ready and the actor has write authority. The browser cannot supply tenant, actor, unit, amount, pricing snapshot, or idempotency authority.

## Database inventory protection

Database guards complement server authorization:

- booking insert validates active customer, consumed hold, and current unit/type/location ownership
- composite customer and reschedule foreign keys preserve same-tenant ownership
- original booking commercial/ownership evidence is immutable
- reschedule evidence is append-only
- allocation writes take the per-unit advisory lock and must match the latest reschedule target, or original dates when no reschedule exists
- allocation writes reject unavailable blocks, effective holds, or overlapping non-cancelled allocations
- deferred constraints require confirmed bookings and new reschedules to commit with the exact effective allocation
- cancellation is terminal and serialized with the physical unit
- hold/block/unit mutation guards account for non-cancelled booking allocations

## Customer lifecycle integration

Rental bookings retain immutable customer snapshots and remain customer-data retention boundaries after rescheduling or cancellation. Customer-detail eligibility and final de-identification mutations count both hospitality and rental booking references and fail closed when references exist.

## Explicit boundaries

This foundation exposes staff-only conversion review/confirmation, booking list/detail, same-unit price-neutral date rescheduling, and terminal inventory-release cancellation.

It does not expose public/customer rental checkout or modification, payment/deposit workflows, physical-unit substitution, price-changing amendments/rescheduling, pickup/delivery/return, tax/fee workflows beyond current daily-rate evidence, fulfillment notifications, or external synchronization.

`CONFIRMED` means physical inventory is durably committed under reviewed commercial evidence. It does not imply payment or fulfillment. `CANCELLED` releases SF inventory protection only and does not imply refund or financial side effects.

## Validation

Dependency-free source contracts protect schema relationships, tenant/database guards, confirmation authority, staff reads, reschedule authority/write scope, cancellation, customer retention, and explicit unsupported-workflow boundaries.

Full database validation must run through `npm run test:database` with an explicitly disposable PostgreSQL target. Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. No GitHub Actions are required or used.
