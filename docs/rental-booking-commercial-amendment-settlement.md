# Rental booking commercial amendment settlement

SF has a server-side manual/offline settlement and compensation contract for a prepared same-unit rental commercial amendment. It is deliberately separate from `RentalPaymentTransaction`, which remains the immutable accepted booking-price ledger and is capped by the original booking total.

This slice does not expose a staff settlement button or final amendment apply action yet. Moving real adjustment money without a final inventory apply path would be unsafe as a normal product workflow. The service exists so the final apply contract can require durable, provider-backed adjustment evidence instead of browser-authored money or a fake payment state.

## Settlement states

`deriveRentalBookingCommercialAmendmentSettlementState` recognizes only three valid retained states:

- `UNSETTLED` — no adjustment provider evidence exists;
- `SETTLED` — exactly one successful manual adjustment matches the prepared amendment delta; and
- `COMPENSATED` — the exact adjustment was reversed with one successful manual compensation operation.

Anything else is a conflict and fails closed. The contract does not support partial adjustment money, multiple concurrent adjustment operations, currency changes, or ambiguous provider state.

For `ADDITIONAL_CHARGE`, settlement is one exact `OFFLINE_PAYMENT`. Compensation is one exact source-attributed `REFUND` against that adjustment payment. For `REFUND`, settlement is one exact source-attributed `REFUND` against an existing successful manual booking-price payment with enough remaining refundable value. Compensation is one exact `OFFLINE_PAYMENT` restoring the refunded delta.

## Durable evidence

`RentalBookingCommercialAmendmentSettlementTransaction` is append-only tenant evidence linked to one prepared amendment by `(amendmentId, bookingId, organizationId)`. It stores deterministic idempotency, a versioned request fingerprint, lifecycle purpose (`ADJUSTMENT` or `COMPENSATION`), payment kind, successful manual-provider reference, refund source attribution when applicable, currency, exact positive amount, and database-authored creation time.

PostgreSQL independently enforces:

- tenant/booking/amendment ownership;
- at most one `ADJUSTMENT` and one `COMPENSATION` per amendment;
- successful manual provider evidence only;
- exact amendment currency and delta;
- direction-correct payment/refund shape;
- adjustment execution only while the prepared authority is still live;
- compensation only after retained adjustment evidence;
- compensation that exactly reverses the adjustment semantics;
- immutable append-only settlement rows; and
- tenant-wide manual reference isolation across booking-price, damage, security-bond, late-return, and commercial-amendment settlement ledgers.

The database also blocks `PREPARED -> CANCELLED/EXPIRED` while successful adjustment money is uncompensated. This closes the gap where an amendment could otherwise disappear operationally while real money remained outside the accepted booking state. Once compensation is retained, the existing cancellation/expiry lifecycle may terminate the amendment safely.

## Server services

`recordRentalBookingCommercialAmendmentManualSettlement` requires `booking:manage` and `payment:manage`, repeats tenant scope on every read/write, uses the shared rental booking lock plus an amendment-settlement lock, and uses the existing `ManualPaymentProvider` adapter. Currency, direction, amount, booking, amendment, provider code, and settlement purpose are server-derived.

For a refund amendment, the caller identifies the real manual booking-payment reference being refunded. The server proves that the source is a successful tenant-owned manual booking-price payment and calculates its remaining refundable capacity after existing booking refunds and prior commercial-amendment refunds. The adjustment is rejected unless that single retained source can fund the exact prepared delta.

`recordRentalBookingCommercialAmendmentManualCompensation` is the recovery boundary. It can run after the prepared authority expires because real adjustment money may still need to be reversed. It never changes amendment terms, booking money, allocation, custody evidence, or provider history; it only appends exact reverse settlement evidence through the manual adapter.

`readRentalBookingCommercialAmendmentSettlement` requires `booking:read` and `payment:read` and returns the retained amendment, settlement rows, and derived state.

## Manual reference isolation

Commercial-amendment provider references join the existing tenant-wide `sf:rental-manual-reference` namespace. The migration replaces the shared database guard so inserts in any of the five rental cash ledgers reject a provider reference already retained by another ledger. The service also acquires the same reference advisory lock before manual adapter execution and performs an application-level collision check.

Refund `sourceProviderReference` is intentionally allowed to point at an existing payment reference. Only the new refund/payment `providerReference` must be globally unique.

## Final apply boundary

A `SETTLED` adjustment still does not mutate the rental. The next dependency is the final locked commercial-amendment apply service. It must re-lock booking and unit, require exact `SETTLED` evidence, revalidate booking version, custody, effective allocation, inventory, and current pricing, then append the effective reschedule and terminally link the amendment. If that authority is lost after settlement, staff must compensate the adjustment before the amendment can be cancelled or expire.

No route or primary staff action exposes settlement before that final apply boundary exists. This avoids creating a product action that can move money without a supported way to complete the requested rental change.

## Validation

- `src/server/bookings/rental-booking-commercial-amendment-settlement-domain.test.ts` covers exact direction-aware settlement, compensation, conflicts, and deterministic request evidence.
- `scripts/rental-booking-commercial-amendment-settlement-source-contract.test.mjs` protects tenant relations, database authority, global reference isolation, provider-adapter usage, refund-source capacity, compensation, permissions, locks, audit evidence, and the no-UI boundary.
- Full repository validation remains `npm run validate` under the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
