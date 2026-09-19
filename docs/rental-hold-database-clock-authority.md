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

Rental unit relocation, unavailable-date block creation, and unit archival all share the physical-unit advisory lock with hold creation. Their service-level checks now read PostgreSQL `clock_timestamp()` before deciding whether a tenant-owned `ACTIVE` hold still blocks the mutation.

The database remains the independent final authority. The original rental-hold migration already guards hold overlap, unavailable-date block creation, and protected unit mutation with `CURRENT_TIMESTAMP` while holding the same tenant/unit advisory lock. Application checks provide clear errors and avoid avoidable database conflicts; they do not replace the trigger contract.

## Boundaries

This hardening does not change hold duration policy, pricing, customer booking conversion, automatic expiration jobs, cancellation policy, or payment behavior. It does not rewrite historical timestamps. It only makes fresh time-sensitive hold decisions use one durable clock authority instead of process-local wall clocks.

## Validation

`scripts/rental-hold-database-clock-authority-source-contract.test.mjs` protects the PostgreSQL clock reads, idempotent replay ordering, database-derived hold timestamps/expiry, effective-list/review/release decisions, create-route status feedback, and the related inventory-mutation active-hold checks.

Full Prisma, TypeScript, lint, production build, and disposable-PostgreSQL validation remain part of the repository's normal local/manual validation path under the Node version declared by `package.json`.

GitHub Actions are not required or used.
