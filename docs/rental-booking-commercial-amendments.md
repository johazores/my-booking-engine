# Rental booking commercial amendments

SF has a server-only preparation plus manual/offline settlement foundation for a same-unit rental date change whose fresh target price differs from the immutable accepted booking total in the same currency. Durable amendment evidence and adjustment money remain separate from the accepted booking-price ledger.

The current product does **not** expose a staff prepare button, commercial-settlement button, or final commercial apply action. A prepared or settled amendment does not move allocation dates, change the immutable accepted booking total, reserve target inventory, alter custody history, or claim the requested date change succeeded. Final apply must exist before this becomes a normal staff workflow.

## Reviewed authority

`reviewRentalBookingRescheduleAuthority` performs the staff review. When every lifecycle and inventory condition is valid and the only blocker is a same-currency `PRICE_CHANGED` result, it derives `commercialAmendmentFingerprint` from server evidence.

The review fingerprint binds organization and booking identity, booking `updatedAt` version, current effective physical unit/type/location, source and target dates, exact before/after money and direction, source/target pricing fingerprints, custody mode, and retained pickup-event identity for a custody extension. Currency drift never receives commercial-amendment authority.

## Preparation

`prepareRentalBookingCommercialAmendment` requires `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `payment:manage`. It runs in a serializable transaction with bounded retry handling, takes the shared booking and effective-unit locks, uses PostgreSQL time authority, repeats tenant scope, and revalidates lifecycle, effective assignment, custody shape, target inventory, pricing, the reviewed fingerprint, and complete fully-paid accepted booking-price settlement.

Only then can it persist one `PREPARED` amendment. Browser input never supplies authoritative currency, totals, delta, direction, pricing fingerprints, booking version, physical assignment, payment state, custody state, or expiry. Preparation itself does not mutate the booking or allocation and does not collect money; later manual settlement is a separate server contract.

Prepared evidence expires after 15 minutes if no uncompensated adjustment money exists. `cancelRentalBookingCommercialAmendment` can terminate a live prepared amendment as `CANCELLED`; stale preparation can become `EXPIRED`. Both transitions are audited.

## Settlement and compensation

Adjustment settlement is implemented separately in [rental-booking-commercial-amendment-settlement.md](./rental-booking-commercial-amendment-settlement.md). It uses a dedicated append-only ledger rather than extending `RentalPaymentTransaction` beyond the immutable accepted booking total.

The enabled provider contract is intentionally manual/offline only. An increase records the exact prepared delta as one manual payment. A decrease records the exact delta as one source-attributed manual refund only when one retained booking-price payment has enough remaining refundable value. Exact compensation is also implemented so real adjustment money can be reversed if final inventory/pricing authority is later lost.

PostgreSQL prevents a prepared amendment with uncompensated adjustment money from being cancelled or expired. This means a lost final-apply authority becomes an explicit compensation/recovery state rather than silently abandoning real money.

## Durable evidence

`RentalBookingCommercialAmendment` retains immutable source/target dates, current effective unit/type/location IDs, custody mode and pickup-event ID, booking version, before/after totals, delta/direction, source/target pricing fingerprints, target pricing snapshot, review fingerprint, and database-time expiry.

Its current lifecycle remains `PREPARED`, `CANCELLED`, and `EXPIRED`. There is intentionally no `APPLIED` state yet because final commercial application is not implemented. The settlement ledger does not pretend otherwise.

PostgreSQL independently enforces amendment date/money/custody/lifecycle shape, tenant ownership, idempotency, at most one prepared amendment, immutable reviewed terms, append-only retention, exact settlement evidence, and uncompensated-money terminal guards.

## Final apply boundary

The next dependency is the final commercial amendment apply contract. It must require exact `SETTLED` adjustment evidence, re-lock the booking and current effective unit, revalidate booking version, lifecycle/custody, target inventory, current target pricing, and prepared terms, then append date-change evidence, move only effective allocation dates, version the booking, and terminally link the amendment to the applied reschedule.

If any of those conditions are lost after real adjustment money moved, the existing manual compensation service must reverse the adjustment before the amendment can terminate. Provider-backed/online adjustment settlement remains a separate later scope behind provider adapters.

## Product surface

No route or primary staff action exposes preparation yet as a commercial mutation workflow, and no route or primary staff action exposes commercial settlement yet. The existing reschedule page remains truthful: price-neutral changes use the supported apply path; same-currency price changes show exact commercial impact but remain blocked; currency changes require pricing configuration repair.

This boundary is deliberate. SF does not offer a primary action that moves adjustment money until it can also complete or safely recover the corresponding rental mutation.

## Validation

- `src/server/bookings/rental-booking-commercial-amendment-domain.test.ts` covers preparation authority and deterministic amendment evidence.
- `src/server/bookings/rental-booking-commercial-amendment-settlement-domain.test.ts` covers exact manual adjustment and compensation state.
- `scripts/rental-booking-commercial-amendment-source-contract.test.mjs` protects preparation persistence and authority.
- `scripts/rental-booking-commercial-amendment-settlement-source-contract.test.mjs` protects settlement persistence, database guards, provider boundaries, recovery, and no-UI exposure.
- Full repository validation remains `npm run validate` on the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
