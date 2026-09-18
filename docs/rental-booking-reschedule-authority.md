# Rental booking reschedule authority

SF has a server-authoritative preflight for same-unit rental date changes. The existing ordinary writer remains deliberately price-neutral, while the review derives and exposes the exact commercial impact of current target-date pricing before deciding which backend contract owns the change.

`reviewRentalBookingRescheduleAuthority` accepts the authenticated organization, actor, booking ID, and proposed exclusive-end date range. It requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`; every booking, allocation, inventory, and pricing query remains tenant-scoped.

The target range is normalized as calendar dates and capped at 90 days. The review uses PostgreSQL `clock_timestamp()` and validates the current effective allocation rather than assuming immutable booking-time dates are still operational after a prior reschedule or physical-unit substitution.

Current target inventory is rejected when it overlaps an unavailable block, an effective active hold, another non-cancelled booking allocation, or incompatible overdue custody. The booking's own current allocation and custody are the only booking-specific sources excluded from those target conflict checks.

## Commercial impact

Current rate periods are rebuilt with the rental pricing engine. The review compares that fresh server-derived quote with the current effective accepted amount and returns one commercial-impact classification:

- `UNCHANGED` — same currency and exact aggregate amount;
- `INCREASE` — same currency with a positive target-price delta;
- `DECREASE` — same currency with a negative target-price delta; or
- `CURRENCY_CHANGED` — current unit-type pricing currency differs from the accepted booking currency.

For same-currency changes, the review returns the exact absolute minor-unit delta together with accepted and target totals. Browser values never determine those amounts.

`CURRENCY_CHANGED` is a pricing-configuration integrity blocker, not a supported commercial amendment. Staff must correct the unit-type pricing configuration rather than reinterpret an accepted booking in another currency.

The review blocker set is `NO_CHANGE`, `CUSTODY_EXTENSION_REQUIRED`, `INVENTORY_CONFLICT`, `CURRENCY_CHANGED`, and `PRICE_CHANGED`. `PRICE_CHANGED` is used only for a same-currency increase or decrease. The staff review page shows accepted amount, fresh target amount, and exact delta; it exposes no apply action for a commercial change and no commercial settlement action.

Ordinary apply authority is ready only when the commercial impact is `UNCHANGED` and every lifecycle/inventory check passes. This keeps `applyRentalBookingReschedule` price-neutral.

A review blocked only by `PRICE_CHANGED` also receives a server-derived commercial-amendment review fingerprint. That fingerprint binds tenant/booking identity, booking version, current effective unit/type/location, source and target dates, exact before/after money and direction, source and target pricing fingerprints, custody mode, and pickup-event identity when custody has started. The fingerprint is never created for currency drift or an inventory/lifecycle blocker.

The fingerprint is the stale-review input for the internal commercial-amendment workflow described in [rental-booking-commercial-amendments.md](./rental-booking-commercial-amendments.md). Preparation, exact manual/offline adjustment settlement, compensation, final locked apply, protected post-apply refund recording, and exact-zero cancellation are implemented as backend contracts. They remain intentionally absent from the commercial reschedule staff primary actions until authenticated orchestration is complete.

## Stale-authority protection

A price-neutral ready review receives a version-3 SHA-256 authority fingerprint binding tenant/booking identity, booking `updatedAt`, current effective physical assignment, effective source dates, proposed target dates, exact unchanged money, effective source pricing fingerprint, current target pricing fingerprint, authority mode, and retained pickup-event identity when custody has started.

The review itself reserves nothing. `applyRentalBookingReschedule` later reacquires the tenant/booking and physical-unit locks, rebuilds the same authority, and fails closed if lifecycle, custody, inventory, pricing, ownership, effective source dates, or booking version changed.

Commercial amendment preparation likewise reserves nothing. It reacquires the booking and effective-unit locks, re-derives current target pricing and inventory authority, requires the accepted booking price to be fully reconciled as paid, and verifies the commercial review fingerprint before it can persist immutable adjustment evidence.

Commercial final apply is separate from the ordinary price-neutral writer. After exact adjustment settlement, `applyRentalBookingCommercialAmendment` reacquires booking/amendment/unit locks, revalidates lifecycle, inventory, pricing and settlement authority, appends the durable reschedule, moves the effective allocation, and links the amendment terminally as `APPLIED`. The original `RentalBooking` money snapshot is not rewritten.

The protected [effective settlement contract](./rental-booking-effective-settlement.md) combines the immutable original booking-price ledger with the one supported applied commercial amendment and append-only post-apply refunds. The post-apply refund writer allocates only from server-derived retained sources, and cancellation may release inventory only after this combined effective settlement proves exact zero net. PostgreSQL independently enforces the same cancellation money boundary.

The durable design keeps original booking commercial evidence immutable. Successful price-neutral changes are recorded in append-only `rental_booking_reschedules` rows and only the effective `RentalBookingAllocation` dates move. Price-changing changes use separate amendment and adjustment evidence plus the linked applied reschedule. See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

Physical-unit substitution, unit-type/location changes, cancellation fee policy, delivery, and other fulfillment changes remain separate contracts. Only one applied price-changing rental amendment is currently supported; another reschedule or commercial amendment after it remains fail-closed. Direct writes to the original booking-price ledger also remain blocked after apply.

Repository-wide validation remains `npm run validate` under the Node version declared by `package.json`. Database-backed validation remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
