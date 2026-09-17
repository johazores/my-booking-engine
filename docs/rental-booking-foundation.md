# Rental booking foundation

SF has a durable rental booking persistence and staff lifecycle boundary. It converts one active physical-unit hold into one confirmed tenant booking, exposes tenant-scoped staff history/detail, supports same-unit price-neutral date rescheduling through append-only evidence, supports same-type/same-location physical-unit substitution through append-only evidence, supports terminal pre-pickup cancellation that releases live inventory while retaining history, supports append-only pickup/return physical-custody evidence, supports explicit post-return release of complete remaining rental days, records one append-only return-condition inspection after custody handback, and supports explicit operational damage-case follow-up for non-clear inspections.

The commercial contract remains intentionally narrow: it establishes ownership, immutable booking-time customer/commercial evidence, effective physical-unit allocation, idempotency, inventory protection/release, reschedule/substitution authority, physical custody handoff/return evidence, early-return inventory release evidence, return-condition evidence, operational damage-case/repair-estimate evidence, auditability, and staff review without inventing deposits, online checkout/card authorization, unit-type/location changes, price-changing amendments, delivery, late-return fees, customer damage liability/charging, security-bond settlement, or customer self-service behavior.

## Durable records

`RentalBooking` stores tenant/customer identity, immutable customer snapshot, source hold, original booking-time physical unit/type/location, confirmation idempotency key, lifecycle, original booking-time dates, currency, exact accepted total, immutable pricing evidence, conversion-authority fingerprint, and confirmation/cancellation timestamps.

`RentalBookingAllocation` is the current physical inventory commitment. It binds one booking to one tenant-owned effective unit and live inventory-protection range. Cancellation retains the allocation as historical evidence; inventory guards treat it as non-blocking once the parent booking is `CANCELLED`. After explicit early-return release, its exclusive end may be shorter than the retained committed rental end.

`RentalBookingReschedule` is append-only evidence for a supported same-unit, price-neutral date change. It stores effective source/target dates, unchanged money, source/target pricing fingerprints, target pricing snapshot, reviewed authority fingerprint, stable idempotency key, and application timestamp.

`RentalBookingUnitSubstitution` is append-only evidence for a supported same-type/same-location physical-unit replacement. It stores source/target unit IDs, effective dates, unchanged money/pricing evidence, reviewed authority fingerprint, stable idempotency key, and application timestamp. The original `RentalBooking.unitId` is never rewritten.

`RentalBookingFulfillmentEvent` is append-only physical-custody evidence. It snapshots the current effective physical unit ID/code/name, committed dates, server-derived idempotency key, PostgreSQL event time, and either `PICKED_UP` or `RETURNED`. Return requires prior pickup; pickup is the boundary after which cancellation, rescheduling, and physical-unit substitution fail closed.

`RentalBookingEarlyReturnRelease` is append-only tenant-owned evidence linking the exact return event, effective unit, committed rental period, shortened live allocation end, immutable return timestamp, server-derived idempotency key, and PostgreSQL release time.

`RentalReturnInspection` is append-only tenant-owned condition evidence linked to the exact `RETURNED` event and returned physical unit. It records one `CLEAR`, `DAMAGE_REPORTED`, or `UNSAFE` outcome per booking, retained notes, inspecting actor, organization-scoped idempotency, and PostgreSQL-authored inspection time.

`RentalDamageCase` is tenant-owned operational follow-up for one non-clear return inspection. It retains one case per booking/inspection, deterministic server-derived idempotency, `OPEN -> ASSESSED -> CLOSED` or waiver lifecycle evidence, exact repair estimate in the retained booking currency, audit actors, and PostgreSQL-authored lifecycle times. Its estimate is not customer liability or settlement authority.

Rental booking/customer, reschedule, substitution, fulfillment, early-return release, return-inspection, and damage-case relationships use tenant-composite database foreign keys or tenant-bound database constraints.

## Confirmation writer

`confirmRentalBookingFromHold` is server-only and requires `booking:manage`, `availability:manage`, `inventory:read`, `pricing:read`, and `customer:read`.

It runs in a serializable transaction under tenant/idempotency and tenant/physical-unit locks, uses PostgreSQL time, and revalidates active hold/customer/unit/type/location, unavailable blocks, effective holds, live booking allocations, complete hold pricing evidence, current pricing, and exact conversion authority.

Only after exact hold consumption does the transaction create booking, allocation, and audit evidence. Replay succeeds only for the same tenant-local hold/customer/authority identity.

## Reschedule lifecycle

Same-unit, price-neutral rescheduling is documented in [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

Review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Apply additionally requires `availability:manage`.

Review and apply derive the current effective physical unit from latest substitution evidence and the current effective source period from latest reschedule evidence. Target dates are rejected when they overlap an unavailable block, effective hold, or another non-cancelled booking. Target pricing must preserve accepted currency and exact aggregate amount.

Apply reacquires the tenant/booking plus effective physical-unit lock, rebuilds authority, derives idempotency server-side, inserts append-only reschedule evidence, changes only effective allocation dates, advances booking `updatedAt`, and records an audit event. Database guards reject new reschedules after pickup custody evidence exists.

## Physical-unit substitution lifecycle

Same-type/same-location substitution is documented in [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md).

Candidate search requires `booking:manage` and `inventory:read`; review additionally requires `availability:read`; apply additionally requires `availability:manage`.

Review derives current source unit from latest substitution history, current dates from latest reschedule history, and checks target lifecycle/type/location plus blocks, effective holds, overdue open custody, and other live allocations. A version-2 authority fingerprint binds the current booking version, source/target unit, retained type/location, effective dates, exact accepted money, and effective pricing fingerprint.

Apply locks the booking and both source/target units in deterministic order, rebuilds authority, inserts append-only substitution evidence, changes only the effective allocation unit, advances booking `updatedAt`, and records an audit event. Idempotent replay is accepted only while the matching substitution is still current. Database guards reject new substitutions after pickup custody evidence exists.

## Cancellation lifecycle

`cancelRentalBooking` requires `booking:manage` and `availability:manage`, runs in a serializable transaction under the tenant/booking plus current effective physical-unit lock, and validates the current allocation including latest reschedule and substitution evidence.

The final `CONFIRMED -> CANCELLED` write remains an exact compare-and-swap over immutable booking evidence plus observed version. Allocation and append-only modification history remain retained. Live inventory guards ignore the retained allocation only after the parent booking is cancelled.

Cancellation is pre-pickup only. A database guard using the same tenant/booking lock namespace rejects cancellation after any fulfillment custody event exists.

See [rental-booking-cancellation.md](./rental-booking-cancellation.md).

## Fulfillment, early-return release, return inspection, and damage follow-up

The supported custody state machine is `AWAITING_PICKUP -> PICKED_UP -> RETURNED` and is documented in [rental-booking-fulfillment-foundation.md](./rental-booking-fulfillment-foundation.md).

Pickup and return require `booking:manage` plus `inventory:manage`. The server derives tenant, actor, effective unit/dates, event time, and idempotency authority; the browser submits no custody authority fields.

Each writer takes the booking lock followed by the effective physical-unit lock, validates the exact allocation after prior reschedule/substitution evidence, requires the effective unit to remain active at the retained booking assignment, uses PostgreSQL time, inserts append-only fulfillment evidence, and records an audit event in one serializable transaction.

Return requires prior pickup and cannot predate it. Return itself does not release or shorten the live allocation. After return, authorized staff may explicitly release only complete remaining rental days. The release derives its cutoff from the immutable return event in the retained booking-location timezone, keeps the committed rental dates and accepted money unchanged, inserts append-only release evidence, and shortens only `RentalBookingAllocation.endsOn`.

After `RETURNED`, authorized staff may record one durable return inspection. The inspection is bound to the exact return event and returned unit. `DAMAGE_REPORTED` and `UNSAFE` require retained notes and move an available unit to `OUT_OF_SERVICE` before the inspection is inserted; the database independently enforces that quarantine boundary. A clear inspection does not alter operational state.

A non-clear inspection can feed one explicit damage case. Opening the case preserves physical-unit quarantine; `OPEN` and `ASSESSED` cases prevent the unit from returning to `AVAILABLE` or being archived. Assessment stores an exact repair estimate in the booking currency, but that amount is operational evidence only and does not establish customer liability, an amount due, a payment, refund, or security-bond decision. Waiver or closure is explicit and terminal, and neither automatically restores unit availability.

See [rental-early-return-inventory-release.md](./rental-early-return-inventory-release.md), [rental-return-inspection.md](./rental-return-inspection.md), and [rental-damage-case.md](./rental-damage-case.md). Late-return handling, delivery, customer damage liability/charging, security bonds, fulfillment notifications, and external synchronization remain separate contracts.

## Staff booking interaction

The authenticated hold detail supports bounded active-customer search, conversion review, and confirmation only after ready server authority.

`/inventory/rentals/bookings` and `/inventory/rentals/bookings/[booking-id]` provide `booking:read`-protected tenant history/detail. List/detail show the committed rental period and current effective physical unit; after early-return release they separately show the shorter live inventory-protection end. Detail preserves original booking-time dates/unit, append-only reschedule/substitution/fulfillment/release history, accepted money, customer snapshot, source evidence, cancellation evidence, retained return inspection, and any retained damage case.

Reschedule and unit-substitution pages provide fresh GET review and POST Apply only when review is ready and the actor has the corresponding write authority. Mutation routes never accept tenant, actor, money, pricing snapshot, source-unit authority, or commercial idempotency authority from the browser.

The booking detail exposes a real pickup POST only while custody is awaiting pickup and a real return POST only after pickup, gated in the UI by `booking:manage` plus `inventory:manage`. After return, the same permissions expose `Release remaining inventory` only when at least one complete rental day can be released and expose `Record return inspection` only while no inspection evidence exists. A retained non-clear inspection exposes real open/assess/waive/close damage-case actions under the same dual write permissions. Server and database checks remain authoritative.

## Database inventory protection

Database guards complement server authorization:

- booking insert validates active customer, consumed hold, and current unit/type/location ownership;
- composite customer, reschedule, substitution, fulfillment, early-return release, return-inspection, and damage-case foreign keys/constraints preserve same-tenant ownership;
- original booking commercial/ownership evidence is immutable;
- reschedule, substitution, fulfillment, early-return release, and return-inspection evidence is append-only; damage-case source evidence and terminal states are immutable;
- the effective unit is derived from latest substitution history while committed dates are derived from latest reschedule history;
- allocation writes take per-unit advisory locks and must match current effective unit and either the committed dates or the exact shortened end retained by early-return release evidence;
- allocation/substitution writes reject unavailable blocks, effective holds, or overlapping non-cancelled allocations;
- deferred constraints require confirmed bookings, reschedules, substitutions, and early-return release evidence to commit with the exact effective allocation;
- cancellation is terminal and serialized with the effective physical unit;
- fulfillment insert validates the exact committed allocation/unit snapshot and pickup-before-return order under booking/unit locks;
- early-return release requires exact `RETURNED` evidence and a still-full committed allocation before it can shorten inventory protection;
- return inspection requires exact tenant `RETURNED` evidence for the same unit, database-authored timestamps, and `OUT_OF_SERVICE` state for non-clear outcomes;
- damage-case insert requires exact non-clear tenant inspection evidence, matching booking currency, active retained unit, deterministic idempotency, and `OUT_OF_SERVICE`; lifecycle timestamps are database-authored;
- unresolved damage cases prevent `AVAILABLE` operational state and unit archival at both application/database boundaries where applicable;
- after pickup, database guards reject new cancellation, reschedule, and unit-substitution writes;
- rental units with a non-cancelled booking allocation cannot be archived, relocated, or retyped;
- hold/block/unit mutation guards account for non-cancelled booking allocations.

## Customer lifecycle integration

Rental bookings retain immutable customer snapshots and remain customer-data retention boundaries after rescheduling, substitution, fulfillment, early-return release, return inspection, damage follow-up, or cancellation. Customer-detail eligibility and final de-identification mutations count both hospitality and rental booking references and fail closed when references exist.

## Explicit boundaries

This foundation exposes staff-only conversion review/confirmation, booking list/detail, same-unit price-neutral date rescheduling, same-type/same-location physical-unit substitution, pre-pickup terminal inventory-release cancellation, pickup/return custody evidence, explicit whole-day post-return inventory release, one append-only return-condition inspection with non-clear operational quarantine, and explicit non-clear damage-case assessment/waiver/resolution evidence.

It does not expose public/customer rental checkout or modification, deposit/online payment workflows, unit-type/location-changing substitution, price-changing amendments/rescheduling, customer pickup/drop-off location selection, delivery, late-return fees, customer damage liability/charging, security-bond capture/release/forfeit, repair-cost settlement, tax/fee workflows beyond current daily-rate evidence, automatic maintenance creation from inspection/damage case, fulfillment notifications, or external synchronization.

`CONFIRMED` means physical inventory is durably committed under reviewed commercial evidence. It does not imply payment or fulfillment; custody transfer remains a separate append-only lifecycle. `PICKED_UP` and `RETURNED` are derived from immutable fulfillment events. An early-return release changes only live physical inventory protection; it does not alter the committed rental period or money. A return inspection records condition evidence only. A damage-case assessment records operational repair-estimate evidence only; neither inspection nor damage case mutates accepted money or establishes customer liability. `CANCELLED` releases SF inventory protection only and does not imply refund or financial side effects.

## Validation

Dependency-free source contracts protect schema relationships, tenant/database guards, confirmation authority, staff reads, reschedule/substitution authority and write scope, cancellation, pickup/return custody authority, early-return inventory release, return-inspection evidence/quarantine, damage-case lifecycle/quarantine, customer retention, and explicit unsupported-workflow boundaries.

Full database validation must run through `npm run test:database` with an explicitly disposable PostgreSQL target. Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. No GitHub Actions are required or used.
