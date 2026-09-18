# Rental booking commercial amendment preparation

SF now has a server-only preparation foundation for a same-unit rental date change whose fresh target price differs from the immutable accepted booking total in the same currency. This is durable commercial evidence, not a completed adjustment workflow.

The current product does **not** expose a staff prepare button, payment/refund executor, or final commercial apply action. A prepared amendment does not move allocation dates, change the accepted booking total, reserve target inventory, collect money, issue a refund, alter custody history, or claim provider success. Those capabilities must be implemented and validated before a price-changing date change can become user-applicable.

## Reviewed authority

`reviewRentalBookingRescheduleAuthority` continues to perform the public staff review. When every lifecycle and inventory condition is valid and the only blocker is a same-currency `PRICE_CHANGED` result, it derives `commercialAmendmentFingerprint` from server evidence.

The review fingerprint binds:

- organization and booking identity;
- booking `updatedAt` version;
- current effective physical unit, retained unit type, and retained location;
- effective source dates and reviewed target dates;
- exact accepted and target totals in the accepted booking currency;
- adjustment direction and absolute minor-unit delta;
- effective source and fresh target pricing fingerprints;
- pre-pickup versus custody-extension mode; and
- retained pickup-event identity for a custody extension.

Currency drift never receives commercial-amendment authority. It remains a pricing-configuration integrity failure.

## Preparation service

`prepareRentalBookingCommercialAmendment` requires `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `payment:manage`. Tenant and actor identifiers are server inputs and every booking, inventory, pricing, payment-history, and amendment query repeats `organizationId`.

Preparation derives idempotency from booking identity plus the reviewed commercial fingerprint. It runs in a serializable transaction with bounded retry handling, acquires the shared rental booking lock and current effective physical-unit lock, and uses PostgreSQL `clock_timestamp()` as lifecycle authority.

Under those locks it revalidates:

- confirmed and unreturned booking lifecycle;
- effective unit after append-only unit substitutions;
- effective source dates/pricing evidence after append-only reschedules;
- exact retained allocation;
- active retained unit type/location assignment;
- custody-extension shape after pickup;
- target blocks, live holds, competing booking allocations, and overdue custody;
- current target pricing and same-currency non-zero delta;
- the reviewed commercial fingerprint; and
- complete bounded rental payment history with the accepted booking total fully reconciled as `PAID`.

Only then can it persist one `PREPARED` amendment. The service does not trust browser-supplied currency, totals, delta, direction, pricing fingerprints, booking version, physical assignment, payment state, custody state, or expiry.
Preparation does not mutate the booking or allocation, and it does not collect money, issue a refund, or call a payment provider.

## Durable evidence

`RentalBookingCommercialAmendment` stores immutable reviewed commercial terms separately from `RentalBooking` and `RentalBookingReschedule`. The retained evidence includes source/target dates, current effective unit/type/location IDs, custody mode and pickup-event ID, booking version, accepted and target totals, absolute delta, direction, source/target pricing fingerprints, target pricing snapshot, review fingerprint, and a database-time-based expiry.

The initial lifecycle contains only states that are actually implemented: `PREPARED`, `CANCELLED`, and `EXPIRED`. There is intentionally no `APPLIED` state yet because final commercial application is not implemented.

PostgreSQL independently enforces date shape, ISO currency form, positive non-zero adjustment money, direction/total consistency, custody-extension shape, lifecycle shape, expiry ordering, tenant/booking foreign-key ownership, tenant idempotency, and at most one `PREPARED` amendment per tenant booking. A database trigger makes the reviewed commercial terms and expiry immutable while allowing only supported lifecycle termination, and deletion is blocked so evidence cannot be erased.

Prepared evidence expires after 15 minutes. The next prepare attempt records stale `PREPARED` evidence as `EXPIRED` under the booking lock. `cancelRentalBookingCommercialAmendment` can terminate a live prepared amendment as `CANCELLED`; both lifecycle transitions write tenant-scoped audit events.

## Settlement boundary

The existing `RentalPaymentTransaction` ledger remains the authoritative booking-price settlement stream and is intentionally capped by the immutable accepted booking total. This preparation foundation does not misuse that ledger to collect an increase beyond the accepted total or fabricate a refund for a decrease.

The next dependency is a dedicated amendment settlement/refund executor that binds real provider evidence to one prepared amendment without rewriting prior booking-price evidence. Only after exact adjustment settlement can a final apply service re-lock the booking/unit, revalidate target inventory and custody, prove the prepared evidence is still current, move the effective allocation dates, append durable date-change evidence, version the booking, and terminally link the amendment to that apply event.

If inventory or pricing authority changes before final apply, the future workflow must fail closed and reconcile any real adjustment money; preparation itself deliberately avoids creating that compensation problem by performing no provider action.

## Product surface

No route or primary staff action exposes preparation yet. The existing reschedule page remains truthful: price-neutral changes may use the supported apply path; same-currency price changes show exact commercial impact but remain blocked; currency changes require configuration repair.

This server-only foundation exists so the later settlement/apply slice can be built on durable, tenant-safe, stale-review-protected commercial evidence instead of introducing browser-authored money or a placeholder workflow.

## Validation

- `src/server/bookings/rental-booking-commercial-amendment-domain.test.ts` covers reviewed-input normalization, exact direction, expiry, review-fingerprint sensitivity, and deterministic idempotency.
- `scripts/rental-booking-commercial-amendment-source-contract.test.mjs` protects Prisma ownership, database constraints, lifecycle immutability, tenant/permission scope, booking/unit locks, fresh inventory/pricing checks, fully-paid reconciliation, audit evidence, and the absence of a user-facing commercial apply action.
- Full repository validation remains `npm run validate` on the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
