# Rental custody evidence integrity

SF treats rental pickup, return, and early-return inventory release as durable custody evidence rather than mutable workflow flags. The application services already derive their idempotency keys and event timestamps server-side. The database now repeats the simple deterministic parts of that authority so direct inserts cannot create evidence that the normal service would never emit.

## Fulfillment evidence

`RentalBookingFulfillmentEvent.idempotencyKey` must equal `rental-fulfillment:<booking-id>:<kind-lowercase>`. PostgreSQL rejects any other value even if it is unique.

The fulfillment evidence trigger also rejects an event timestamp later than PostgreSQL `clock_timestamp()`. Return evidence must resolve the retained pickup event for the same tenant and booking, must use the same physical unit and committed date snapshot, and cannot predate pickup. These checks complement the existing confirmed-booking, effective-allocation, active-unit, pickup-window, append-only, and one-event-per-kind guards.

The timestamp check intentionally uses PostgreSQL time rather than `createdAt`. `createdAt` uses `CURRENT_TIMESTAMP`, which is transaction-start time in PostgreSQL and can legitimately be earlier than a later `clock_timestamp()` captured for the custody event inside the same serializable transaction.

## Early-return release evidence

`RentalBookingEarlyReturnRelease.idempotencyKey` must equal `rental-early-return-release:<booking-id>`. PostgreSQL also rejects a `releasedAt` value later than its own current clock.

The existing release guard remains authoritative for the exact tenant booking, effective unit, return event, committed dates, location timezone, shortened allocation boundary, and return-before-release chronology. The new constraints do not change customer dates, accepted money, payment evidence, or inventory-release policy.

## Scope

This hardening does not add late fees, automatic cancellation, extensions, inspection/damage state, security bonds, delivery, maintenance, notifications, provider-backed rental payments, or customer self-service. It only strengthens evidence that existing production custody workflows already persist.

## Validation

`scripts/rental-custody-evidence-authority-source-contract.test.mjs` verifies that the application idempotency formulas and database constraints remain aligned, return evidence is tied to the retained pickup assignment, and database clock authority is enforced for custody/release timestamps.

The migration still requires execution through the repository's guarded disposable-PostgreSQL validation path before the open Phase 1 live-database gates can be claimed complete. GitHub Actions are not used.
