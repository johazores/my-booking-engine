# Rental booking fulfillment foundation

SF supports an authenticated staff custody lifecycle for durable rental bookings: `AWAITING_PICKUP -> PICKED_UP -> RETURNED`.

This is deliberately narrower than a full rental operations suite. Pickup and return record physical custody evidence only. They do not create deposits/security bonds, authorize cards, collect money, assess late/damage fees, run inspections, create maintenance work, trigger notifications, or call external providers.

## Durable evidence

`RentalBookingFulfillmentEvent` is append-only tenant-owned evidence. Each event snapshots the effective physical unit ID/code/name, effective rental dates, server-derived idempotency key, event kind, and PostgreSQL event time.

A booking can have at most one pickup and one return. Return requires prior pickup and cannot predate it. Prisma models the tenant-composite booking and physical-unit relations with the same named foreign keys created by the migration, so schema validation/drift checks and database referential integrity describe the same ownership boundary.

`RentalBookingEarlyReturnRelease` is separate append-only inventory-release evidence. It links the exact return event to the effective unit, retains the committed rental dates, and records a shorter live allocation end without rewriting the customer's committed period.

## Write authority

Pickup and return require both `booking:manage` and `inventory:manage`. Routes derive tenant and actor from authenticated server context and accept no browser-controlled tenant, actor, unit, dates, timestamp, or idempotency authority.

The writer uses the tenant/booking advisory lock followed by the effective physical-unit lock, a serializable transaction, PostgreSQL `clock_timestamp()`, bounded conflict retry, exact effective allocation validation after any supported reschedule/substitution, and audit evidence.

Repeated pickup or return requests replay an existing event only after re-deriving the retained confirmed booking's latest pre-pickup reschedule/substitution assignment. The existing event must still match the effective unit and committed date snapshot and remain present in the tenant-owned custody history. Replay then takes the same effective-unit lock before returning idempotent success. An idempotency key match by itself is not sufficient.

Early-return inventory release uses the same permissions and lock order. It derives the release cutoff from the immutable return timestamp in the retained booking location timezone and only shortens the allocation when at least one complete remaining rental day can be freed. See [rental-early-return-inventory-release.md](./rental-early-return-inventory-release.md).

## Neighboring mutation safety

Pickup is the custody handoff boundary. After any fulfillment event exists, database guards reject new rental reschedules, physical-unit substitutions, or booking cancellation. The staff booking detail hides those actions once pickup is recorded.

These guards use the same tenant/booking advisory lock namespace as the lifecycle writers, so direct database writes cannot race a pickup into an unsafe post-handoff cancellation, date change, or unit change.

Return does **not** release the booking allocation early by itself. Availability remains protected through the committed booking end date until an authorized staff user explicitly applies early-return inventory release. That release only frees complete remaining rental days and does not change accepted money, payment evidence, or the committed rental period.

If pickup remains open when the exclusive effective end date is reached in the retained booking location timezone, the unit becomes overdue custody and is removed from new availability/hold/booking/replacement authority until return is recorded. Staff list/detail reads also surface that server-derived overdue condition using PostgreSQL time and the immutable pickup date snapshot, so the inventory block is visible without creating a fake mutable booking status. See [rental-overdue-custody-availability.md](./rental-overdue-custody-availability.md).

Extensions/late-return handling, fees, damage/inspection state, deposits/security bonds, delivery, maintenance transitions, and notifications remain separate contracts.

## Read model and UI

`getRentalBooking` reads fulfillment and early-return release evidence with tenant scope and derives `AWAITING_PICKUP`, `PICKED_UP`, or `RETURNED` from immutable event history. It also derives read-only overdue custody from a PostgreSQL observation time, the retained booking location timezone, and the pickup event's immutable exclusive end date.

The staff booking detail displays custody history and exposes a real POST pickup action only while awaiting pickup, then a real POST return action only while picked up. An overdue picked-up booking receives an explicit alert and `OVERDUE CUSTODY` badge while preserving the same authorized return action. After return, `Release remaining inventory` is rendered only when whole-day inventory can actually be freed and the actor has `booking:manage` plus `inventory:manage`.

The paginated rental booking list also marks overdue picked-up rows. The booking detail and list distinguish the committed rental period from the shorter live inventory-protection period after an early release. UI checks are usability only; server services and database constraints remain authoritative.

## Validation

- `src/server/bookings/rental-booking-fulfillment-domain.test.ts` covers state derivation, invalid ordering/duplicates, and deterministic idempotency authority.
- `src/server/bookings/rental-booking-custody-read-domain.test.ts` covers operational overdue derivation, location-timezone boundaries, non-overdue lifecycle states, and fail-closed missing pickup evidence.
- `src/server/inventory/rental-custody-availability.test.ts` covers location-timezone date authority and the exclusive-end overdue boundary.
- `src/server/bookings/rental-booking-early-return-release-domain.test.ts` covers whole-day early-return release semantics and deterministic idempotency.
- `scripts/rental-booking-fulfillment-source-contract.test.mjs` protects Prisma/database relation parity, persistence, tenant scope, authorization, locks, PostgreSQL time, replay revalidation, route authority, neighboring mutation guards, and staff action wiring.
- `scripts/rental-overdue-custody-source-contract.test.mjs` protects overdue-custody exclusion across availability and booking authority, database hold/allocation/substitution guards, and staff list/detail visibility.
- `scripts/rental-early-return-inventory-release-source-contract.test.mjs` protects append-only release evidence, exact return-event authority, allocation shortening, database guards, and staff read/UI semantics.
- Full Prisma/migration/database execution remains part of `npm run test:database` against an explicitly disposable PostgreSQL target under the Node version declared in `package.json`.

GitHub Actions are not required or used.
