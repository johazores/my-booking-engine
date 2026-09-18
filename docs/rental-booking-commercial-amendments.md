# Rental booking commercial amendments

SF has a server-only preparation, manual/offline settlement, compensation, and final-apply foundation for a same-unit rental date change whose fresh target price differs from the current effective rental total in the same currency. Durable amendment evidence and adjustment money remain separate from the immutable original booking-price ledger.

The current product does **not** expose a staff prepare button, commercial-settlement button, or final commercial apply action. The backend can safely apply one settled amendment, but authenticated end-to-end orchestration and adjustment-aware post-apply cancellation/refund behavior are not complete, so the product does not present the workflow as generally available.

## Reviewed authority

`reviewRentalBookingRescheduleAuthority` performs the staff review. When every lifecycle and inventory condition is valid and the only blocker is a same-currency `PRICE_CHANGED` result, it derives `commercialAmendmentFingerprint` from server evidence.

The review fingerprint binds organization and booking identity, booking `updatedAt` version, current effective physical unit/type/location, source and target dates, exact before/after money and direction, source/target pricing fingerprints, custody mode, and retained pickup-event identity for a custody extension. Currency drift never receives commercial-amendment authority.

## Preparation

`prepareRentalBookingCommercialAmendment` requires `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `payment:manage`. It runs in a serializable transaction with bounded retry handling, takes the shared booking and effective-unit locks, uses PostgreSQL time authority, repeats tenant scope, and revalidates lifecycle, effective assignment, custody shape, target inventory, pricing, the reviewed fingerprint, and complete fully-paid accepted booking-price settlement.

Only then can it persist one `PREPARED` amendment. Browser input never supplies authoritative currency, totals, delta, direction, pricing fingerprints, booking version, physical assignment, payment state, custody state, or expiry. Preparation itself does not mutate the booking or allocation and does not collect money; later settlement is a separate server contract.

Prepared evidence expires after 15 minutes if no uncompensated adjustment money exists. `cancelRentalBookingCommercialAmendment` can terminate a live prepared amendment as `CANCELLED`; stale preparation can become `EXPIRED`. Both transitions are audited.

## Settlement and compensation

Adjustment settlement is implemented separately in [rental-booking-commercial-amendment-settlement.md](./rental-booking-commercial-amendment-settlement.md). It uses a dedicated append-only ledger rather than extending `RentalPaymentTransaction` beyond the immutable original booking total.

The enabled provider contract is intentionally manual/offline only. An increase records the exact prepared delta as one manual payment. A decrease records the exact delta as one source-attributed manual refund only when one retained booking-price payment has enough remaining refundable value. Exact compensation is also implemented so real adjustment money can be reversed if final inventory/pricing authority is later lost.

PostgreSQL prevents a prepared amendment with uncompensated adjustment money from being cancelled or expired. This means lost final-apply authority becomes an explicit compensation/recovery state rather than silently abandoning real money.

## Final apply

The server-only final writer is documented in [rental-booking-commercial-amendment-apply.md](./rental-booking-commercial-amendment-apply.md).

`applyRentalBookingCommercialAmendment` re-locks the booking, amendment settlement, and effective unit; requires exact `SETTLED` evidence; revalidates the prepared booking version, custody, effective allocation, target inventory, current pricing, and original booking-price reconciliation; appends a `RentalBookingReschedule`; moves only the effective allocation dates; versions the booking; and terminally links the amendment as `APPLIED` to that reschedule.

The original `RentalBooking` money snapshot remains immutable. The applied reschedule carries the new effective target total and pricing evidence. PostgreSQL independently enforces the terminal settlement and linked-reschedule shape.

## Durable evidence

`RentalBookingCommercialAmendment` retains immutable source/target dates, current effective unit/type/location IDs, custody mode and pickup-event ID, booking version, before/after totals, delta/direction, source/target pricing fingerprints, target pricing snapshot, review fingerprint, and database-time expiry.

Its lifecycle is now `PREPARED`, `CANCELLED`, `EXPIRED`, or `APPLIED`. Applied evidence retains the exact linked reschedule and database-authored apply time. Settlement rows remain append-only evidence rather than rewriting original booking-price transactions.

PostgreSQL independently enforces amendment date/money/custody/lifecycle shape, tenant ownership, idempotency, at most one live prepared amendment, immutable reviewed terms, exact settlement evidence, uncompensated-money terminal guards, exact applied-reschedule linkage, and applied lifecycle immutability.

## Current one-amendment boundary

Only one applied price-changing amendment per rental is currently supported. After apply, the database blocks another reschedule, another commercial amendment, new booking-price settlement writes, and booking cancellation until an adjustment-aware effective-total settlement/cancellation contract exists. This is a deliberate fail-closed boundary, not a claimed completed workflow.

The next dependency is unified post-apply commercial settlement semantics: safely reconciling original booking-price money plus applied amendment money for later refunds/cancellation, then exposing a complete authenticated staff workflow. Provider-backed/online adjustment settlement remains separate later scope behind provider adapters.

## Product surface

No route or primary staff action exposes preparation, settlement, compensation, or final apply yet. The existing reschedule page remains truthful: price-neutral changes use the supported apply path; same-currency price changes show exact commercial impact but remain blocked in the staff product; currency changes require pricing configuration repair.

## Validation

- `src/server/bookings/rental-booking-commercial-amendment-domain.test.ts` covers preparation authority and deterministic amendment evidence.
- `src/server/bookings/rental-booking-commercial-amendment-settlement-domain.test.ts` covers exact manual adjustment and compensation state.
- `scripts/rental-booking-commercial-amendment-source-contract.test.mjs` protects preparation persistence and authority.
- `scripts/rental-booking-commercial-amendment-settlement-source-contract.test.mjs` protects settlement persistence, database guards, provider boundaries, recovery, and no-UI exposure.
- `scripts/rental-booking-commercial-amendment-apply-source-contract.test.mjs` protects final apply persistence and the fail-closed post-apply boundary.
- Full repository validation remains `npm run validate` on the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
