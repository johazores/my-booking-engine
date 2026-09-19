# Rental booking reschedule authority

SF has a server-authoritative preflight for same-unit rental date changes. The ordinary writer remains price-neutral. The same review also derives the exact commercial impact needed to hand a same-currency price change into the protected commercial-amendment workflow.

`reviewRentalBookingRescheduleAuthority` requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Every read repeats the authenticated tenant.

The review normalizes the exclusive-end range, uses PostgreSQL time, resolves the current effective allocation after prior reschedule/substitution history, checks custody, active unit/type/location assignment, availability blocks, active holds, competing bookings, overdue custody, and current rate periods.

## Commercial impact and existing amendment boundary

Current pricing is rebuilt from server-owned unit-type/rate evidence and classified as `UNCHANGED`, `INCREASE`, `DECREASE`, or `CURRENCY_CHANGED`.

The blocker set includes:

- `NO_CHANGE`
- `CUSTODY_EXTENSION_REQUIRED`
- `INVENTORY_CONFLICT`
- `CURRENCY_CHANGED`
- `PRICE_CHANGED`
- `COMMERCIAL_AMENDMENT_ACTIVE`
- `COMMERCIAL_AMENDMENT_APPLIED`

A same-currency price change gets `PRICE_CHANGED` plus a commercial-amendment review fingerprint when the booking has not already consumed its one supported price-changing amendment. Currency drift remains a pricing-configuration integrity blocker.

The review reads tenant-scoped `PREPARED`/`APPLIED` amendment lifecycle evidence. A prepared amendment blocks another date mutation until staff finish, compensate, or close it. An applied amendment becomes the accepted effective commercial baseline: its `afterTotalMinor` must reconcile to the latest retained reschedule chain. Later same-unit date changes are allowed only when current server pricing preserves that exact effective amount. A later price change gets `COMMERCIAL_AMENDMENT_APPLIED`, because a second price-changing amendment is still outside the current contract.

When an existing commercial amendment blocks review, the staff page links authorized payment readers back to that retained workspace. After an applied amendment, the same link remains available while a genuinely price-neutral reschedule or custody extension can proceed.

## Stale-authority protection

Price-neutral ready reviews receive the current version-3 reschedule authority fingerprint binding tenant/booking identity, booking version, effective physical assignment, source/target dates, exact unchanged effective money, source/target pricing fingerprints, authority mode, and pickup evidence.

Price-changing reviews receive the separate commercial review fingerprint binding the same authority plus exact before/after money, absolute delta, and commercial direction.

The review itself reserves nothing.

`applyRentalBookingReschedule` reacquires booking/unit locks and rebuilds ordinary authority before writing a price-neutral change. It independently refuses a prepared commercial amendment, reconciles an applied amendment to the latest reschedule chain, and writes the accepted effective total into new append-only reschedule evidence without rewriting immutable booking-time money.

`prepareRentalBookingCommercialAmendment` reacquires booking/unit locks, revalidates inventory/pricing/custody and fully-paid original booking settlement, verifies the commercial review fingerprint, and retains short-lived preparation evidence.

After exact adjustment settlement, `applyRentalBookingCommercialAmendment` re-locks and revalidates booking, unit, inventory, pricing, version, custody, original settlement, and amendment settlement before appending reschedule evidence and moving effective allocation dates.

PostgreSQL independently blocks rescheduling while an amendment is `PREPARED`. After `APPLIED`, the reschedule insert guards require every later reschedule to preserve the applied amendment currency and `afterTotalMinor` while continuing the latest pricing-fingerprint chain.

## Staff workflow

The reschedule page keeps the price-neutral direct Apply form separate from the price-changing Prepare commercial amendment form.

Preparing requires the review permissions plus payment read/manage access so the actor can continue into the authenticated commercial workspace. The browser submits only target dates and the server-issued commercial fingerprint; it does not submit authoritative money, tenant, actor, unit, provider, or direction.

After an applied commercial amendment, the review displays the accepted effective amount separately from immutable original booking money when they differ. Another price-changing Prepare action is not rendered.

See [rental-booking-commercial-amendments.md](./rental-booking-commercial-amendments.md) and [rental-booking-commercial-amendment-settlement.md](./rental-booking-commercial-amendment-settlement.md).

## Deliberate boundaries

Physical-unit substitution, unit-type/location changes, currency-changing amendments, cancellation-fee policy, delivery, and other fulfillment changes remain separate contracts.

Only one applied price-changing rental amendment is currently supported. A later price-neutral same-unit reschedule or custody extension is supported when it preserves the accepted effective post-amendment total. Direct original booking-price ledger writes remain blocked after apply. Physical-unit substitution is also supported before custody after one applied amendment only when it preserves the same retained unit type/location, effective dates, amendment currency, exact `afterTotalMinor`, and latest pricing fingerprint; a `PREPARED` amendment still freezes that inventory reassignment. See [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md).

Full repository validation remains `npm run validate` under the Node version declared by `package.json`. Database validation remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
