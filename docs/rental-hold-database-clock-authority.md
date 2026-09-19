# Rental hold database-clock authority

Rental availability holds use PostgreSQL time as the authority for retention windows and active-hold decisions. Application-server wall clocks are not allowed to decide whether a hold is still effective or whether a competing inventory mutation may proceed.

## Creation authority

`createRentalAvailabilityHold` keeps deterministic idempotent replay ahead of fresh time authority. An already-retained hold is verified from its immutable unit, dates, idempotency key, and retained `createdAt`/`expiresAt` duration without inventing a new observation time.

For a fresh hold, the service first serializes the tenant/idempotency key and physical unit, then reads `clock_timestamp()` from PostgreSQL. That one database observation drives:

- the hold `createdAt` timestamp;
- the pricing `pricingObservedAt` timestamp;
- `expiresAt`, derived as the requested bounded duration after the database observation;
- active overlapping-hold detection;
- overdue-custody observation used by the same inventory decision.

This prevents application-host clock skew from shortening or extending a production inventory hold or from disagreeing with the database overlap guard.

## Read and release authority

The active hold list reads PostgreSQL time inside the same repeatable-read transaction used for the count and page query. A hold is listed as effective only while its retained status is `ACTIVE` and `expiresAt` is later than that database observation.

Pricing review uses the same database-clock rule when deriving its read-only `effective` state. Pricing drift remains a separate concern: current configured pricing can differ from the immutable pricing observation without changing the retained hold window.

The create-hold HTTP route does not infer success from the web process clock. After create or exact idempotent replay it performs a tenant-scoped, `availability:manage`-authorized hold-state read using PostgreSQL `clock_timestamp()` and chooses the `hold-active` or `hold-inactive` redirect from that durable observation. This keeps user-visible feedback aligned with the same clock that protects inventory.

Explicit hold release also reads PostgreSQL time after loading the tenant-owned active hold. If `expiresAt` has already been reached, the write closes it as `EXPIRED`; otherwise it closes it as `RELEASED`. `endedAt` and the audit timestamp evidence use that same database observation.

An expired hold can remain stored with status `ACTIVE` until an explicit lifecycle write closes it. That does not make it effective: all live inventory authority is time-bounded by `expiresAt` against PostgreSQL time.

## Inventory-mutation alignment

Rental unit relocation, unavailable-date block creation, and unit archival all share the physical-unit advisory lock with hold creation. Their service-level checks read PostgreSQL `clock_timestamp()` before deciding whether a tenant-owned `ACTIVE` hold still blocks the mutation.

Physical-unit relocation and archival also use that same post-lock database observation for booking/custody authority. They reject current or future non-cancelled allocations using each booking's retained IANA location timezone, and they reject overdue open custody through the shared extension-aware custody reconciliation helper. A historical booking whose allocation period has ended and whose unit was never picked up, or has already been returned, does not permanently pin the unit to old inventory metadata.

The database remains the independent final authority. Historical hold-trigger bodies used `CURRENT_TIMESTAMP`, which is transaction-start time. That can become stale when a transaction starts before a hold expires, waits on the shared physical-unit lock, and acquires the lock only after the hold has expired.

`20260919182000-rental-hold-trigger-wall-clock` supersedes the active hold-overlap, unavailable-block, and protected-unit-mutation trigger bodies. Each guard samples `clock_timestamp()` once after acquiring the shared tenant/unit advisory lock and uses that wall-clock observation for live hold-expiry comparisons.

`20260919192500-rental-unit-mutation-custody-authority` then tightens the physical-unit mutation guard without changing its trigger binding: current/future booking dates are evaluated from the same post-lock wall clock in the retained booking-location timezone instead of `CURRENT_DATE`, and the existing `sf_rental_unit_has_overdue_custody` predicate prevents a unit from being relocated, retyped, or archived merely because its committed end date passed before the customer returned it.

Application checks provide clear errors and avoid avoidable database conflicts; they do not replace the trigger contract. Historical migrations remain unchanged, while the later migrations define the active trigger behavior.

## Boundaries

This hardening does not change hold duration policy, pricing, customer booking conversion, automatic expiration jobs, cancellation policy, or payment behavior. It does not rewrite historical timestamps or invent customer-facing movement semantics. It only keeps fresh time-sensitive inventory decisions on durable database time and retained custody evidence.

## Validation

`scripts/rental-hold-database-clock-authority-source-contract.test.mjs` protects the application-side PostgreSQL clock reads, idempotent replay ordering, database-derived hold timestamps/expiry, effective-list/review/release decisions, create-route status feedback, and the related inventory-mutation active-hold checks.

`scripts/rental-hold-trigger-wall-clock-source-contract.test.mjs` protects the hold-expiry database backstop by requiring the active hold-sensitive trigger functions to sample `clock_timestamp()` after physical-unit serialization and by rejecting `CURRENT_TIMESTAMP` from their superseding definitions.

`scripts/rental-unit-mutation-custody-source-contract.test.mjs` protects the physical-unit relocation/archive application checks plus the latest booking-timezone and overdue-custody database backstop.

Full Prisma, TypeScript, lint, production build, and disposable-PostgreSQL validation remain part of the repository's normal local/manual validation path under the Node version declared by `package.json`.

GitHub Actions are not required or used.
