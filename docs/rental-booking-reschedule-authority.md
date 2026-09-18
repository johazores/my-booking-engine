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

A same-currency price change gets `PRICE_CHANGED` plus a commercial-amendment review fingerprint. Currency drift remains a pricing-configuration integrity blocker.

The review now also reads tenant-scoped `PREPARED`/`APPLIED` amendment lifecycle evidence. A prepared amendment blocks another review/apply path until staff finish, compensate, or close it. An applied amendment blocks later reschedules under the current one-amendment boundary. This prevents rendering a primary Apply action that the database will necessarily reject.

When an existing commercial amendment blocks review, the staff page links authorized payment readers back to that retained workspace instead of asking them to start a duplicate workflow.

## Stale-authority protection

Price-neutral ready reviews receive the current version-3 reschedule authority fingerprint binding tenant/booking identity, booking version, effective physical assignment, source/target dates, exact unchanged money, source/target pricing fingerprints, authority mode, and pickup evidence.

Price-changing reviews receive the separate commercial review fingerprint binding the same authority plus exact before/after money, absolute delta, and commercial direction.

The review itself reserves nothing.

`applyRentalBookingReschedule` reacquires booking/unit locks and rebuilds ordinary authority before writing a price-neutral change.

`prepareRentalBookingCommercialAmendment` reacquires booking/unit locks, revalidates inventory/pricing/custody and fully-paid original booking settlement, verifies the commercial review fingerprint, and retains short-lived preparation evidence.

After exact adjustment settlement, `applyRentalBookingCommercialAmendment` re-locks and revalidates booking, unit, inventory, pricing, version, custody, original settlement, and amendment settlement before appending reschedule evidence and moving effective allocation dates.

## Staff workflow

The reschedule page keeps the price-neutral direct Apply form separate from the price-changing Prepare commercial amendment form.

Preparing requires the review permissions plus payment read/manage access so the actor can continue into the authenticated commercial workspace. The browser submits only target dates and the server-issued commercial fingerprint; it does not submit authoritative money, tenant, actor, unit, provider, or direction.

See [rental-booking-commercial-amendments.md](./rental-booking-commercial-amendments.md) and [rental-booking-commercial-amendment-settlement.md](./rental-booking-commercial-amendment-settlement.md).

## Deliberate boundaries

Physical-unit substitution, unit-type/location changes, currency-changing amendments, cancellation-fee policy, delivery, and other fulfillment changes remain separate contracts.

Only one applied price-changing rental amendment is currently supported. Direct original booking-price ledger writes also remain blocked after apply.

Full repository validation remains `npm run validate` under the Node version declared by `package.json`. Database validation remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
