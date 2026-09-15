# Rental booking foundation

SF has a durable rental booking persistence and staff lifecycle boundary. It converts one active physical-unit hold into one confirmed tenant booking, exposes tenant-scoped staff history/detail, supports same-unit price-neutral date rescheduling through append-only evidence, supports same-type/same-location physical-unit substitution through append-only evidence, and supports terminal cancellation that releases live inventory while retaining history.

The commercial contract remains intentionally narrow: it establishes ownership, immutable booking-time customer/commercial evidence, effective physical-unit allocation, idempotency, inventory protection/release, reschedule/substitution authority, auditability, and staff review without inventing payment/deposit, unit-type/location changes, price-changing amendment, pickup/delivery/return, fulfillment, or customer self-service behavior.

## Durable records

`RentalBooking` stores tenant/customer identity, immutable customer snapshot, source hold, original booking-time physical unit/type/location, confirmation idempotency key, lifecycle, original booking-time dates, currency, exact accepted total, immutable pricing evidence, conversion-authority fingerprint, and confirmation/cancellation timestamps.

`RentalBookingAllocation` is the current physical inventory commitment. It binds one booking to one tenant-owned effective unit and current effective date range. Cancellation retains the allocation as historical evidence; inventory guards treat it as non-blocking once the parent booking is `CANCELLED`.

`RentalBookingReschedule` is append-only evidence for a supported same-unit, price-neutral date change. It stores effective source/target dates, unchanged money, source/target pricing fingerprints, target pricing snapshot, reviewed authority fingerprint, stable idempotency key, and application timestamp.

`RentalBookingUnitSubstitution` is append-only evidence for a supported same-type/same-location physical-unit replacement. It stores source/target unit IDs, effective dates, unchanged money/pricing evidence, reviewed authority fingerprint, stable idempotency key, and application timestamp. The original `RentalBooking.unitId` is never rewritten.

Rental booking/customer, reschedule, and substitution relationships use tenant-composite database foreign keys.

## Confirmation writer

`confirmRentalBookingFromHold` is server-only and requires `booking:manage`, `availability:manage`, `inventory:read`, `pricing:read`, and `customer:read`.

It runs in a serializable transaction under tenant/idempotency and tenant/physical-unit locks, uses PostgreSQL time, and revalidates active hold/customer/unit/type/location, unavailable blocks, effective holds, live booking allocations, complete hold pricing evidence, current pricing, and exact conversion authority.

Only after exact hold consumption does the transaction create booking, allocation, and audit evidence. Replay succeeds only for the same tenant-local hold/customer/authority identity.

## Reschedule lifecycle

Same-unit, price-neutral rescheduling is documented in [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

Review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Apply additionally requires `availability:manage`.

Review and apply derive the current effective physical unit from latest substitution evidence and the current effective source period from latest reschedule evidence. Target dates are rejected when they overlap an unavailable block, effective hold, or another non-cancelled booking. Target pricing must preserve accepted currency and exact aggregate amount.

Apply reacquires the tenant/booking plus effective physical-unit lock, rebuilds authority, derives idempotency server-side, inserts append-only reschedule evidence, changes only effective allocation dates, advances booking `updatedAt`, and records an audit event.

## Physical-unit substitution lifecycle

Same-type/same-location substitution is documented in [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md).

Candidate search requires `booking:manage` and `inventory:read`; review additionally requires `availability:read`; apply additionally requires `availability:manage`.

Review derives current source unit from latest substitution history, current dates from latest reschedule history, and checks target lifecycle/type/location plus blocks, effective holds, and other live allocations. A version-2 authority fingerprint binds the current booking version, source/target unit, retained type/location, effective dates, exact accepted money, and effective pricing fingerprint.

Apply locks the booking and both source/target units in deterministic order, rebuilds authority, inserts append-only substitution evidence, changes only the effective allocation unit, advances booking `updatedAt`, and records an audit event. Idempotent replay is accepted only while the matching substitution is still current.

## Cancellation lifecycle

`cancelRentalBooking` requires `booking:manage` and `availability:manage`, runs in a serializable transaction under the tenant/booking plus current effective physical-unit lock, and validates the current allocation including latest reschedule and substitution evidence.

The final `CONFIRMED -> CANCELLED` write remains an exact compare-and-swap over immutable booking evidence plus observed version. Allocation and append-only modification history remain retained. Live inventory guards ignore the retained allocation only after the parent booking is cancelled.

See [rental-booking-cancellation.md](./rental-booking-cancellation.md).

## Staff booking interaction

The authenticated hold detail supports bounded active-customer search, conversion review, and confirmation only after ready server authority.

`/inventory/rentals/bookings` and `/inventory/rentals/bookings/[booking-id]` provide `booking:read`-protected tenant history/detail. List/detail show current effective allocation dates and unit; detail separately preserves original booking-time dates/unit, append-only reschedule/substitution history, accepted money, customer snapshot, source evidence, and cancellation evidence.

Reschedule and unit-substitution pages provide fresh GET review and POST Apply only when review is ready and the actor has the corresponding write authority. Mutation routes never accept tenant, actor, money, pricing snapshot, source-unit authority, or idempotency authority from the browser.

## Database inventory protection

Database guards complement server authorization:

- booking insert validates active customer, consumed hold, and current unit/type/location ownership;
- composite customer, reschedule, and substitution foreign keys preserve same-tenant ownership;
- original booking commercial/ownership evidence is immutable;
- reschedule and substitution evidence is append-only;
- the effective unit is derived from latest substitution history while effective dates are derived from latest reschedule history;
- allocation writes take per-unit advisory locks and must match current effective unit and dates;
- allocation/substitution writes reject unavailable blocks, effective holds, or overlapping non-cancelled allocations;
- deferred constraints require confirmed bookings, reschedules, and substitutions to commit with exact effective allocation;
- cancellation is terminal and serialized with the effective physical unit;
- rental units with a non-cancelled booking allocation cannot be archived, relocated, or retyped;
- hold/block/unit mutation guards account for non-cancelled booking allocations.

## Customer lifecycle integration

Rental bookings retain immutable customer snapshots and remain customer-data retention boundaries after rescheduling, substitution, or cancellation. Customer-detail eligibility and final de-identification mutations count both hospitality and rental booking references and fail closed when references exist.

## Explicit boundaries

This foundation exposes staff-only conversion review/confirmation, booking list/detail, same-unit price-neutral date rescheduling, same-type/same-location physical-unit substitution, and terminal inventory-release cancellation.

It does not expose public/customer rental checkout or modification, payment/deposit workflows, unit-type/location-changing substitution, price-changing amendments/rescheduling, pickup/delivery/return, tax/fee workflows beyond current daily-rate evidence, fulfillment notifications, or external synchronization.

`CONFIRMED` means physical inventory is durably committed under reviewed commercial evidence. It does not imply payment or fulfillment. `CANCELLED` releases SF inventory protection only and does not imply refund or financial side effects.

## Validation

Dependency-free source contracts protect schema relationships, tenant/database guards, confirmation authority, staff reads, reschedule/substitution authority and write scope, cancellation, customer retention, and explicit unsupported-workflow boundaries.

Full database validation must run through `npm run test:database` with an explicitly disposable PostgreSQL target. Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. No GitHub Actions are required or used.
