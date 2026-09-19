# Rental booking commercial amendments

SF supports one server-authoritative same-unit price-changing rental date amendment. The workflow keeps the immutable original `RentalBooking` money snapshot intact while retaining separate reviewed terms, exact adjustment settlement, final reschedule evidence, post-apply effective settlement, and exact-zero cancellation authority.

The production path is now exposed to authenticated staff for the supported manual/offline provider contract. Staff can move from a fresh price-changing date review into preparation, record the exact real-world adjustment or refund, apply the reviewed dates only after fresh server revalidation, compensate retained adjustment money when apply cannot proceed, and record server-planned post-apply refunds. The staff surface does not collect or refund money itself.

## Review and preparation

`reviewRentalBookingRescheduleAuthority` remains the entry point. Price-neutral same-unit changes receive ordinary reschedule authority. A same-currency `INCREASE` or `DECREASE` receives a commercial-amendment review fingerprint instead.

The commercial fingerprint binds tenant/booking identity, booking version, effective unit/type/location, current and target dates, accepted and target totals, exact delta/direction, source and target pricing fingerprints, custody mode, and pickup evidence when custody has started.

The reschedule review now refuses to render a dead date-change action when the booking already has a `PREPARED` or `APPLIED` commercial amendment. A prepared workflow must be completed, compensated, or closed first. An applied amendment remains the current one-amendment boundary, so later reschedules stay fail-closed.

Authenticated staff with the required booking, inventory, pricing, and payment authority can POST the reviewed target dates plus the server-issued review fingerprint to the preparation route. The browser does not submit tenant, actor, unit, location, currency, amount, direction, expiry, provider, or idempotency authority.

`prepareRentalBookingCommercialAmendment` reacquires the booking/current-unit locks, uses PostgreSQL time, revalidates lifecycle/custody/inventory/current pricing, verifies the review fingerprint, requires the original accepted booking amount to be fully reconciled as paid, and persists a short-lived `PREPARED` amendment. Preparation does not move booking dates, reserve additional inventory, or move money.

## Staff orchestration

The authenticated staff workspace is:

`/inventory/rentals/bookings/[booking-id]/commercial-amendments/[amendment-id]`

It requires `booking:read` plus `payment:read` and reads the tenant-scoped retained amendment and settlement state from server services. UI permission checks are usability only; every write service repeats its own tenant and permission checks.

The workspace exposes only operations already backed by production server contracts:

- `UNSETTLED` + live `PREPARED`: record the exact manual/offline adjustment.
- `SETTLED` + live `PREPARED`: final apply after explicit confirmation, or record exact compensation if the real-world adjustment is reversed.
- `SETTLED` + expired preparation: compensation remains available so retained money can be reversed; final apply is not shown.
- `COMPENSATED` or `UNSETTLED`: close the amendment without applying dates. An expired prepared amendment is terminalized as expired by the server.
- `APPLIED`: read combined effective settlement and record supported manual/offline post-apply refunds from the server-selected source.
- `CANCELLED` / `EXPIRED`: read retained evidence only.

For a refund amendment, SF derives the source from complete bounded booking-price settlement evidence instead of accepting a browser-selected payment reference. It verifies that the original accepted amount remains fully paid, subtracts prior retained commercial-amendment refund consumption, and deterministically chooses the manual payment with the largest remaining refundable capacity. The exact adjustment fails closed when no one retained source can cover the delta. The staff page shows this current server-derived source read-only, while the writer recomputes it under the shared booking lock before recording the refund.

Prepared/live state shown in the workspace also comes from PostgreSQL time returned by the protected settlement reader rather than the application host clock. The write path independently repeats the database-time expiry check.

Manual/offline staff actions are evidence-recording operations. Staff must perform or confirm the real-world cash/payment movement outside SF first, then retain the unique receipt/refund reference. SF does not collect or refund money from these forms.

## Settlement and compensation

`recordRentalBookingCommercialAmendmentManualSettlement` requires `booking:manage` and `payment:manage`, locks booking and amendment settlement authority, and derives exact currency/delta and any refund source from retained server evidence.

For `ADDITIONAL_CHARGE`, the only enabled adjustment is one exact manual `OFFLINE_PAYMENT`.

For `REFUND`, the only enabled adjustment is one exact source-attributed manual refund against the server-selected retained successful original booking-price payment with sufficient remaining capacity.

`recordRentalBookingCommercialAmendmentManualCompensation` reverses one settled adjustment exactly. An additional charge is compensated by a source-attributed refund against that adjustment payment. A refund amendment is compensated by an exact manual payment restoring the refunded delta. Compensation remains available after preparation expiry while the amendment is still `PREPARED`, because real money may need recovery even when apply authority has expired.

Settlement evidence is append-only, request-fingerprinted, tenant-scoped, and isolated in the tenant-wide rental manual-reference namespace. PostgreSQL independently blocks terminalization while uncompensated adjustment money exists.

See [rental-booking-commercial-amendment-settlement.md](./rental-booking-commercial-amendment-settlement.md).

## Final apply

`applyRentalBookingCommercialAmendment` requires booking/payment management plus availability/inventory/pricing authority. It locks the booking, amendment settlement, and current effective unit, then revalidates:

- amendment status and expiry;
- exact booking version and tenant scope;
- custody shape;
- current physical allocation;
- target inventory conflicts;
- overdue custody;
- current target pricing and target pricing fingerprint;
- original booking-price settlement; and
- exactly one uncompensated adjustment matching the amendment.

Only after those checks does apply append the terminal reschedule evidence, move the effective allocation dates, advance the booking version, and mark the amendment `APPLIED`. Original accepted booking money is never rewritten.

See [rental-booking-commercial-amendment-apply.md](./rental-booking-commercial-amendment-apply.md).

## Post-apply effective settlement and refunds

After apply, money authority comes from the protected combined settlement model rather than `RentalBooking.totalMinor` alone.

An applied increase combines the original booking ledger plus the retained amendment payment. Refunds unwind the amendment payment first, then original booking-payment sources.

An applied decrease already includes the retained source-attributed adjustment refund against original booking money, so later refunds cannot reuse that consumed source value.

`recordRentalBookingPostApplyManualRefund` never accepts a browser-selected source. The staff form submits only a human amount and real-world refund reference. The route resolves the current effective currency server-side, parses the major-unit amount, and the writer re-reads effective settlement under the shared booking lock to select and cap the exact retained source. One refund cannot span sources.

Exact-zero cancellation consumes the same effective settlement. Cancellation never manufactures refund evidence.

See [rental-booking-effective-settlement.md](./rental-booking-effective-settlement.md) and [rental-booking-cancellation.md](./rental-booking-cancellation.md).

## Deliberate boundaries

Only one applied price-changing commercial amendment per rental is supported. Another reschedule, another commercial amendment, and direct writes to the original booking-price ledger remain blocked after apply.

The supported staff orchestration is manual/offline evidence only. Provider-backed/online adjustment collection, provider-backed/online refunds, automatic cancellation fees, automatic refund policy, delivery/one-way changes, customer self-service, notifications, invoices, and external fleet synchronization remain separate contracts. Provider-specific behavior stays behind adapters.

No route accepts browser authority for tenant, actor, currency, amendment delta, direction, provider code, booking version, effective unit, idempotency, pre-apply refund source, or post-apply refund source.

## Validation

- `src/server/bookings/rental-booking-commercial-amendment-domain.test.ts` protects commercial review/preparation invariants.
- `src/server/bookings/rental-booking-commercial-amendment-settlement-domain.test.ts` protects exact adjustment, compensation, and deterministic refund-source allocation.
- `src/server/bookings/rental-booking-effective-settlement-domain.test.ts` and `src/server/bookings/rental-booking-effective-refund-domain.test.ts` protect combined post-apply money authority.
- `scripts/rental-booking-commercial-amendment-source-contract.test.mjs` protects preparation persistence and server authority.
- `scripts/rental-booking-commercial-amendment-settlement-source-contract.test.mjs` protects settlement persistence, manual provider evidence, server-owned refund-source authority, compensation, and staff wiring.
- `scripts/rental-booking-commercial-amendment-apply-source-contract.test.mjs` protects final locked apply.
- `scripts/rental-booking-effective-refund-source-contract.test.mjs` protects post-apply refund source authority.
- `scripts/rental-booking-commercial-amendment-staff-orchestration-source-contract.test.mjs` protects the authenticated end-to-end staff handoff, route authority, database-time readiness, permission gating, and no-dead-action boundary.
- `scripts/rental-booking-commercial-amendment-refund-source-authority-source-contract.test.mjs` protects the focused no-browser-source contract.
- Full repository validation remains `npm run validate` under the Node version declared in `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
