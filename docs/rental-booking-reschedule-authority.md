# Rental booking reschedule authority

SF has a server-authoritative preflight for same-unit rental date changes. The existing writer remains deliberately price-neutral, but the review now derives and exposes the exact commercial impact of current target-date pricing before deciding whether apply authority exists.

`reviewRentalBookingRescheduleAuthority` accepts the authenticated organization, actor, booking ID, and proposed exclusive-end date range. It requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`; every booking, allocation, inventory, and pricing query remains tenant-scoped.

The target range is normalized as calendar dates and capped at 90 days. The review uses PostgreSQL `clock_timestamp()` and validates the current effective allocation rather than assuming immutable booking-time dates are still operational after a prior reschedule or physical-unit substitution.

Current target inventory is rejected when it overlaps an unavailable block, an effective active hold, another non-cancelled booking allocation, or incompatible overdue custody. The booking's own current allocation and custody are the only booking-specific sources excluded from those target conflict checks.

## Commercial impact

Current rate periods are rebuilt with the rental pricing engine. The review compares that fresh server-derived quote with the immutable accepted booking amount and returns one commercial-impact classification:

- `UNCHANGED` — same currency and exact aggregate amount;
- `INCREASE` — same currency with a positive target-price delta;
- `DECREASE` — same currency with a negative target-price delta; or
- `CURRENCY_CHANGED` — current unit-type pricing currency differs from the accepted booking currency.

For same-currency changes, the review returns the exact absolute minor-unit delta together with accepted and target totals. Browser values never determine those amounts.

`CURRENCY_CHANGED` is a pricing-configuration integrity blocker, not a supported commercial amendment. Staff must correct the unit-type pricing configuration rather than reinterpret an accepted booking in another currency.

The review blocker set is `NO_CHANGE`, `CUSTODY_EXTENSION_REQUIRED`, `INVENTORY_CONFLICT`, `CURRENCY_CHANGED`, and `PRICE_CHANGED`. `PRICE_CHANGED` is used only for a same-currency increase or decrease. The staff review page shows accepted amount, fresh target amount, and exact delta, but it exposes no apply action for a commercial change.

Apply authority is ready only when the commercial impact is `UNCHANGED` and every lifecycle/inventory check passes. This makes price-changing review useful operationally without pretending SF already has a rental commercial-amendment settlement writer.

## Stale-authority protection

A ready review receives a version-3 SHA-256 authority fingerprint binding tenant/booking identity, booking `updatedAt`, current effective physical assignment, effective source dates, proposed target dates, exact unchanged money, effective source pricing fingerprint, current target pricing fingerprint, authority mode, and retained pickup-event identity when custody has started.

The review itself reserves nothing. `applyRentalBookingReschedule` later reacquires the tenant/booking and physical-unit locks, rebuilds the same authority, and fails closed if lifecycle, custody, inventory, pricing, ownership, effective source dates, or booking version changed.

The durable design keeps original booking commercial evidence immutable. Successful price-neutral changes are recorded in append-only `rental_booking_reschedules` rows and only the effective `RentalBookingAllocation` dates move. See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

Physical-unit substitution, unit-type/location changes, price-changing amendment persistence, payment/refund adjustment, cancellation financial policy, delivery, and other fulfillment changes remain separate contracts. A same-currency `INCREASE` or `DECREASE` therefore remains review-only until a dedicated append-only commercial amendment and settlement contract exists.

Repository-wide validation remains `npm run validate` under the Node version declared by `package.json`. Database-backed validation remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
