# Rental booking commercial amendment settlement

SF has a server-side manual/offline settlement and compensation contract for a prepared same-unit rental commercial amendment. It is deliberately separate from `RentalPaymentTransaction`, which remains the immutable original booking-price ledger and is capped by the original booking total.

This settlement service is still not exposed as a staff primary action. It supplies durable adjustment evidence to the server-only final apply contract without allowing browser-authored money or fake provider state.

## Settlement states

`deriveRentalBookingCommercialAmendmentSettlementState` recognizes only three valid retained states:

- `UNSETTLED` — no adjustment provider evidence exists;
- `SETTLED` — exactly one successful manual adjustment matches the prepared amendment delta; and
- `COMPENSATED` — the exact adjustment was reversed with one successful manual compensation operation.

Anything else is a conflict and fails closed. The contract does not support partial adjustment money, multiple concurrent adjustment operations, currency changes, or ambiguous provider state.

For `ADDITIONAL_CHARGE`, settlement is one exact `OFFLINE_PAYMENT`. Compensation is one exact source-attributed `REFUND` against that adjustment payment. For `REFUND`, settlement is one exact source-attributed `REFUND` against an existing successful manual booking-price payment with enough remaining refundable value. Compensation is one exact `OFFLINE_PAYMENT` restoring the refunded delta.

## Durable evidence

`RentalBookingCommercialAmendmentSettlementTransaction` is append-only tenant evidence linked to one prepared amendment by `(amendmentId, bookingId, organizationId)`. It stores deterministic idempotency, a versioned request fingerprint, lifecycle purpose (`ADJUSTMENT` or `COMPENSATION`), payment kind, successful manual-provider reference, refund source attribution when applicable, currency, exact positive amount, and database-authored creation time.

PostgreSQL independently enforces tenant/booking/amendment ownership, at most one adjustment and one compensation, successful manual provider evidence only, exact amendment currency and delta, direction-correct payment/refund shape, adjustment execution only while prepared authority is live, compensation only after retained adjustment evidence, exact reverse compensation semantics, append-only settlement rows, and tenant-wide manual reference isolation across all current rental cash ledgers.

The database blocks `PREPARED -> CANCELLED/EXPIRED` while successful adjustment money is uncompensated. It also blocks `PREPARED -> APPLIED` unless exactly one successful adjustment exists and no compensation exists.

## Server services

`recordRentalBookingCommercialAmendmentManualSettlement` requires `booking:manage` and `payment:manage`, repeats tenant scope on every read/write, uses the shared rental booking lock plus an amendment-settlement lock, and uses the existing `ManualPaymentProvider` adapter. Currency, direction, amount, booking, amendment, provider code, and settlement purpose are server-derived.

For a refund amendment, the caller identifies the real manual booking-payment reference being refunded. The server proves that the source is a successful tenant-owned manual booking-price payment and calculates its remaining refundable capacity after existing booking refunds and prior commercial-amendment refunds. The adjustment is rejected unless that single retained source can fund the exact prepared delta.

`recordRentalBookingCommercialAmendmentManualCompensation` is the recovery boundary. It can run after prepared authority expiry while the amendment is still `PREPARED`, because real adjustment money may still need to be reversed. It never changes amendment terms, booking money, allocation, custody evidence, or provider history; it only appends exact reverse settlement evidence through the manual adapter.

`readRentalBookingCommercialAmendmentSettlement` requires `booking:read` and `payment:read` and returns retained amendment, settlement rows, and derived state.

## Manual reference isolation

Commercial-amendment provider references join the existing tenant-wide `sf:rental-manual-reference` namespace. Inserts in any current rental cash ledger reject a provider reference already retained by another ledger. The service also acquires the same reference advisory lock before manual adapter execution and performs an application-level collision check.

Refund `sourceProviderReference` is intentionally allowed to point at an existing payment reference. Only the new refund/payment `providerReference` must be globally unique.

## Final apply and post-apply boundary

A `SETTLED` adjustment can now be consumed only by `applyRentalBookingCommercialAmendment`, documented in [rental-booking-commercial-amendment-apply.md](./rental-booking-commercial-amendment-apply.md). Apply revalidates settlement under the same amendment-settlement lock before mutating allocation dates or terminally linking the amendment.

After apply, settlement rows cannot be extended or compensated by this contract because the amendment is no longer `PREPARED`. Current post-apply booking-price refund/cancellation semantics are intentionally blocked at the database boundary until they can reconcile original booking-price transactions together with applied amendment adjustment evidence.

No route or primary staff action exposes settlement yet.

## Validation

- `src/server/bookings/rental-booking-commercial-amendment-settlement-domain.test.ts` covers exact direction-aware settlement, compensation, conflicts, and deterministic request evidence.
- `scripts/rental-booking-commercial-amendment-settlement-source-contract.test.mjs` protects tenant relations, database authority, global reference isolation, provider-adapter usage, refund-source capacity, compensation, permissions, locks, audit evidence, and the no-UI boundary.
- `scripts/rental-booking-commercial-amendment-apply-source-contract.test.mjs` protects settlement consumption during final apply and post-apply fail-closed guards.
- Full repository validation remains `npm run validate` under the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
