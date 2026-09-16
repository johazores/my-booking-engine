# Rental booking fulfillment foundation

SF supports an authenticated staff custody lifecycle for durable rental bookings: `AWAITING_PICKUP -> PICKED_UP -> RETURNED`.

This is deliberately narrower than a full rental operations suite. Pickup and return record physical custody evidence only. They do not create deposits/security bonds, authorize cards, collect money, assess late/damage fees, run inspections, create maintenance work, trigger notifications, or call external providers.

## Durable evidence

`RentalBookingFulfillmentEvent` is append-only tenant-owned evidence. Each event snapshots the effective physical unit ID/code/name, effective rental dates, server-derived idempotency key, event kind, and PostgreSQL event time.

A booking can have at most one pickup and one return. Return requires prior pickup and cannot predate it. Database foreign keys bind fulfillment evidence to the tenant booking and physical unit even though the Prisma model intentionally keeps scalar references so the existing booking/inventory models do not need speculative navigation fields.

## Write authority

Pickup and return require both `booking:manage` and `inventory:manage`. Routes derive tenant and actor from authenticated server context and accept no browser-controlled tenant, actor, unit, dates, timestamp, or idempotency authority.

The writer uses the tenant/booking advisory lock followed by the effective physical-unit lock, a serializable transaction, PostgreSQL `clock_timestamp()`, bounded conflict retry, exact effective allocation validation after any supported reschedule/substitution, and audit evidence.

Repeated pickup or return requests replay the existing event idempotently instead of creating duplicate custody evidence.

## Neighboring mutation safety

Pickup is the custody handoff boundary. After any fulfillment event exists, database guards reject new rental reschedules, physical-unit substitutions, or booking cancellation. The staff booking detail hides those actions once pickup is recorded.

These guards use the same tenant/booking advisory lock namespace as the lifecycle writers, so direct database writes cannot race a pickup into an unsafe post-handoff cancellation, date change, or unit change.

Return does **not** release the booking allocation early. Availability remains protected through the effective booking end date. Early-return release, extension/late-return handling, fees, damage/inspection state, and maintenance transitions require separate commercial rules.

## Read model and UI

`getRentalBooking` reads fulfillment evidence with tenant scope and derives `AWAITING_PICKUP`, `PICKED_UP`, or `RETURNED` from immutable event history.

The staff booking detail displays custody history and exposes a real POST pickup action only while awaiting pickup, then a real POST return action only while picked up. UI checks are usability only; server services and database constraints remain authoritative.

## Validation

- `src/server/bookings/rental-booking-fulfillment-domain.test.ts` covers state derivation, invalid ordering/duplicates, and deterministic idempotency authority.
- `scripts/rental-booking-fulfillment-source-contract.test.mjs` protects persistence, tenant scope, authorization, locks, PostgreSQL time, route authority, neighboring mutation guards, and staff action wiring.
- Full Prisma/migration/database execution remains part of `npm run test:database` against an explicitly disposable PostgreSQL target under the Node version declared in `package.json`.

GitHub Actions are not required or used.
