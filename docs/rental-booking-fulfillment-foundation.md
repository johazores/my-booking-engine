# Rental booking fulfillment foundation

SF supports an authenticated staff custody lifecycle for durable rental bookings: `AWAITING_PICKUP -> PICKED_UP -> RETURNED`.

Pickup and return record physical custody evidence. They do not themselves create security bonds, authorize cards, collect money, assess late/damage fees, run inspections, create maintenance work, trigger notifications, or call external providers. Those responsibilities remain in their separate production boundaries.

Pickup is valid only while the current committed rental date range is active in the retained booking location timezone: the local date must be on or after the effective start and before the exclusive effective end. See [rental-booking-pickup-window.md](./rental-booking-pickup-window.md).

While custody is open after pickup, SF now supports one narrow neighboring mutation: a same-unit, current-start, later-end **price-neutral custody extension** through the append-only reschedule lifecycle. Cancellation and physical-unit substitution remain closed. Arbitrary rescheduling, shortening, moving the start date, and price-changing extensions remain unsupported.

## Durable evidence

`RentalBookingFulfillmentEvent` is append-only tenant-owned evidence. Each event snapshots the effective physical unit ID/code/name, effective rental dates, server-derived idempotency key, event kind, and PostgreSQL event time.

A booking can have at most one pickup and one return. Return requires prior pickup and cannot predate it. Prisma models the tenant-composite booking and physical-unit relations with the same named foreign keys created by the migration, so schema validation/drift checks and database referential integrity describe the same ownership boundary.

`RentalBookingEarlyReturnRelease` is separate append-only inventory-release evidence. It links the exact return event to the effective unit, retains the committed rental dates, and records a shorter live allocation end without rewriting the customer's committed period.

A custody extension reuses `RentalBookingReschedule` evidence rather than mutating fulfillment history. The immutable pickup event keeps the unit/date snapshot that was true at handoff; the latest append-only reschedule becomes the effective committed period for later operational authority.

## Write authority

Pickup and return require both `booking:manage` and `inventory:manage`. Routes derive tenant and actor from authenticated server context and accept no browser-controlled tenant, actor, unit, dates, timestamp, or idempotency authority.

The fulfillment writer uses the tenant/booking advisory lock followed by the effective physical-unit lock, a serializable transaction, PostgreSQL `clock_timestamp()`, bounded conflict retry, exact effective allocation validation after any supported reschedule/substitution, and audit evidence.

Before pickup is written, the service combines that PostgreSQL timestamp with the retained booking location timezone and the current effective committed dates. Pickup before the local start date or at/after the exclusive local end date fails closed. A dedicated database trigger repeats the booking lock, latest-reschedule date derivation, retained-location timezone lookup, PostgreSQL clock authority, and pickup-window check for direct inserts, so a caller-provided event timestamp cannot bypass the current window.

Repeated pickup or return requests replay an existing event only after re-deriving the retained confirmed booking's latest assignment. The existing event must still match the effective physical unit and the committed date snapshot that applies to that event and remain present in the tenant-owned custody history. Pickup replay additionally verifies that the retained pickup timestamp fell inside its retained committed local-date window. An idempotency-key match by itself is not sufficient.

Early-return inventory release uses the same booking/inventory permissions and lock order. It derives the release cutoff from the immutable return timestamp in the retained booking location timezone and only shortens the allocation when at least one complete remaining rental day can be freed. See [rental-early-return-inventory-release.md](./rental-early-return-inventory-release.md).

## Neighboring mutation safety

Pickup is the physical handoff boundary.

Cancellation and physical-unit substitution remain closed after custody starts. Fresh cancellation rechecks tenant-owned fulfillment evidence inside the shared booking lock before settlement work, and substitution keeps its existing pre-custody lifecycle checks. Their database guards remain hard fail-closed.

Date changes use a narrower rule. Before pickup, the existing same-unit price-neutral reschedule contract remains available. After pickup and before return, the same writer may only keep the current effective start and extend the current effective end later, while preserving the effective unit and accepted aggregate price. The authority fingerprint binds `CUSTODY_EXTENSION` mode and the immutable pickup-event ID so a pre-pickup review cannot cross the custody boundary unnoticed.

The database custody guard independently mirrors this exception. It replaces only the reschedule pre-fulfillment trigger: returned bookings are rejected, source dates must match the current effective period, target start must remain fixed, target end must move later, and extension application cannot predate pickup evidence. The original hard guards for cancellation and unit replacement remain active.

These application and database checks share the same tenant/booking advisory lock namespace as fulfillment, so pickup, return, extension, cancellation, and unit-replacement decisions cannot race across incompatible lifecycle states.

See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

## Return and inventory release

Return does **not** release the booking allocation early by itself. Availability remains protected through the current committed booking end date until an authorized staff user explicitly applies early-return inventory release. That release only frees complete remaining rental days and does not change accepted money, payment evidence, or the committed rental period.

A return recorded after a custody extension derives the latest effective reschedule dates, so immutable return evidence reflects the extended committed period. Once `RETURNED` exists, no new reschedule or extension is permitted.

## Overdue and missed-pickup visibility

If a picked-up booking reaches its exclusive effective end date without return, the unit becomes overdue custody and is removed from new availability, hold, booking, and replacement authority. Staff list/detail reads surface that server-derived overdue condition using PostgreSQL time and the retained booking location timezone rather than creating a fake mutable booking status.

Overdue status by itself does not create a fee or silently rewrite the booking. While the booking remains `PICKED_UP`, authorized staff may still review the narrow same-unit price-neutral custody extension. If an extension is applied, the latest committed end becomes the new custody deadline. If the unit is returned late instead, the separate late-return assessment workflow may retain an explicit fee or waiver decision.

If no pickup occurred when the exclusive effective end date is reached, the booking remains a confirmed pre-handoff record but is surfaced as **Missed pickup**. This is a read-only operational condition derived from PostgreSQL time, retained location timezone, the latest supported reschedule end, and the absence of fulfillment evidence. It does not automatically cancel, refund, extend, or fee the booking.

## Read model and UI

`getRentalBooking` reads fulfillment and early-return release evidence with tenant scope and derives `AWAITING_PICKUP`, `PICKED_UP`, or `RETURNED` from immutable event history. It also derives read-only overdue custody from a PostgreSQL observation time, the retained booking location timezone, and the current effective committed end.

The staff booking detail displays custody history and exposes a real POST pickup action only while awaiting pickup **and** the committed local-date pickup window is open, then a real POST return action only while picked up. Before the rental start, staff see when pickup opens. After the exclusive end passes without pickup, the primary pickup action is removed and the closed-window state is explained.

While picked up, actors with the existing booking/availability/inventory/pricing review permissions receive an `Extend rental` action. The shared date-change page locks the start date in the UI and reviews only a later end date. UI constraints are usability only; the service and database enforce the same custody-extension shape and price-neutral authority.

An overdue picked-up booking receives an explicit alert while preserving both the authorized return action and, where permissions allow, the supported extension review. After return, `Release remaining inventory` is rendered only when complete rental days can actually be freed and the actor has `booking:manage` plus `inventory:manage`.

The paginated rental booking list continues to mark overdue picked-up rows and missed-pickup rows as operational queues. The booking detail and list distinguish the committed rental period from the shorter live inventory-protection period after an early return release.

## Deliberate boundaries

The custody-extension exception does not implement price-changing extensions, proration, payment adjustment, split settlement, unit-type changes, location changes, delivery, automatic tenant late-fee policy, customer self-service, or provider synchronization.

Damage/inspection state, security bonds, maintenance, late-return assessment, and their settlement workflows remain separate evidence streams. An extension does not automatically create, waive, collect, or refund any fee.

## Validation

- `src/server/bookings/rental-booking-fulfillment-domain.test.ts` covers state derivation, invalid ordering/duplicates, and deterministic idempotency authority.
- `src/server/bookings/rental-booking-pickup-window-domain.test.ts` covers date-window opening/closure, retained-location timezone authority, and invalid committed-date evidence.
- `src/server/bookings/rental-booking-pickup-read-domain.test.ts` covers read-only missed-pickup derivation from that window.
- `src/server/bookings/rental-booking-custody-read-domain.test.ts` covers operational overdue derivation, location-timezone boundaries, non-overdue lifecycle states, and fail-closed missing pickup evidence.
- `src/server/inventory/rental-custody-availability.test.ts` covers location-timezone date authority and the exclusive-end overdue boundary.
- `src/server/bookings/rental-booking-early-return-release-domain.test.ts` covers whole-day early-return release semantics and deterministic idempotency.
- `src/server/bookings/rental-booking-reschedule-domain.test.ts` covers the same-start/later-end extension shape and custody-bound reschedule authority.
- `scripts/rental-booking-fulfillment-source-contract.test.mjs` protects Prisma/database relation parity, persistence, tenant scope, authorization, locks, PostgreSQL time, replay revalidation, route authority, custody mutation guards, the extension exception, and staff action wiring.
- `scripts/rental-booking-pre-custody-writer-source-contract.test.mjs` protects cancellation's hard custody boundary and the custody-aware date-change writer while preserving completed idempotent replay.
- `scripts/rental-booking-reschedule-source-contract.test.mjs` protects the shared pre-pickup reschedule/custody-extension authority and database boundary.
- `scripts/rental-booking-pickup-window-source-contract.test.mjs` protects the pickup-window service, database guard, staff action visibility, and documentation boundary.
- `scripts/rental-overdue-custody-source-contract.test.mjs` protects overdue-custody exclusion across availability and booking authority, database hold/allocation/substitution guards, and staff list/detail visibility.
- `scripts/rental-overdue-custody-queue-source-contract.test.mjs` protects the pre-pagination overdue operational queue.
- `scripts/rental-missed-pickup-queue-source-contract.test.mjs` protects the pre-pagination missed-pickup operational queue and final read-domain agreement.
- `scripts/rental-early-return-inventory-release-source-contract.test.mjs` protects append-only release evidence, exact return-event authority, allocation shortening, database guards, and staff read/UI semantics.
- Full Prisma/migration/database execution remains part of `npm run test:database` against an explicitly disposable PostgreSQL target under the Node version declared in `package.json`.

GitHub Actions are not required or used.
