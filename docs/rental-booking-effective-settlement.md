# Rental booking effective settlement

SF has a protected effective-settlement model for rental bookings plus a server-only post-apply manual refund writer. The model reconciles the immutable original booking-price ledger, the one supported applied price-changing commercial amendment, and append-only post-apply refund evidence without rewriting accepted booking money.

`RentalBooking.totalMinor` remains the accepted booking-time snapshot. After a commercial date amendment, effective money authority therefore comes from the combined evidence streams rather than from the original booking total alone.

## Authority and tenant scope

`readRentalBookingEffectiveSettlement` validates organization, actor, and booking UUIDs, requires both `booking:read` and `payment:read`, and runs under `RepeatableRead`.

Original booking-price evidence uses the bounded `readRentalPaymentSettlementHistory` reader. Applied amendment settlement evidence is fingerprint checked. Post-apply refund evidence uses its own bounded reader, is scoped by organization, booking, and applied amendment, must not predate the amendment apply timestamp, and re-derives deterministic idempotency and request fingerprints before contributing to balances.

`recordRentalBookingPostApplyManualRefund` requires `booking:manage` and `payment:manage`. It runs under `Serializable`, takes the shared tenant/booking advisory lock, re-reads the effective settlement inside the transaction, and accepts only a confirmed booking with exactly one applied amendment.

## Effective commercial math

Without an applied amendment, effective settlement remains the normal reconciled booking-price settlement.

For an applied `ADDITIONAL_CHARGE`, the amendment adjustment payment is a separate source. Post-apply refunds unwind that amendment charge first. Only after its remaining balance reaches zero does the server allocate later refunds to original booking-price sources. This makes source selection deterministic and keeps amendment money separate from the immutable original ledger.

For an applied `REFUND`, the amendment adjustment is already a source-attributed refund against an original booking-price payment. The effective model consumes that refund against its retained source before considering later post-apply booking-price refunds.

Post-apply refund requests do not accept a client-selected payment source. The server derives the next authoritative source. One refund record cannot span sources; the requested amount must fit inside the currently selected source balance.

The returned settlement exposes the immutable original total, effective accepted total, current combined net, booking-price and amendment-charge refund remainders, full-funding/refund state, and the next authoritative refund source.

## Durable post-apply refund evidence

`RentalBookingEffectiveRefundTransaction` is append-only and retains organization, booking, applied amendment, deterministic idempotency key, request fingerprint, source ledger, provider/refund reference, retained source payment reference, currency, amount, and database-authored time.

Only the manual/offline provider contract is enabled. Provider interaction remains behind `ManualPaymentProvider`.

PostgreSQL independently requires a tenant-owned `APPLIED` amendment and successful manual evidence. For `BOOKING_PRICE`, the source must be a retained successful original manual payment and total refunds across original booking refunds, the applied-decrease adjustment when relevant, and post-apply refunds cannot exceed that source. For `COMMERCIAL_AMENDMENT`, the applied amendment must be an increase and the source must be its exact retained adjustment payment. Refunds cannot exceed that payment.

The tenant-wide manual provider-reference namespace now includes post-apply refund evidence at the database boundary.

## Fail-closed behavior

Reconciliation fails instead of guessing on incomplete histories, multiple applied amendments, invalid terminal reschedule evidence, invalid request fingerprints, inconsistent currencies/arithmetic, compensated or malformed adjustment evidence, wrong-ledger refunds, wrong sources, duplicate refund references, source over-refunds, chronology violations, or balances outside the accepted effective total.

The writer also fails closed on stale settlement state, unsupported providers, duplicate/conflicting idempotency evidence, cross-scope manual reference reuse, or a requested amount that would span sources.

## Current boundary

Post-apply refund recording is now implemented as a backend contract, but it is not exposed as a primary staff action yet.

Booking cancellation after an applied commercial amendment remains blocked until the cancellation writer and PostgreSQL cancellation guard both consume the same combined effective settlement and require the effective net to be exactly zero. Chained commercial amendments and later reschedules also remain blocked. Provider-backed/online refund execution remains later adapter-backed scope.

Only one applied price-changing amendment per rental remains supported.

## Validation

- `src/server/bookings/rental-booking-effective-settlement-domain.test.ts` covers effective combined money reconciliation.
- `src/server/bookings/rental-booking-effective-refund-domain.test.ts` covers post-apply source ordering, source-aware refunds, fail-closed evidence, requested-amount authority, and deterministic request evidence.
- `scripts/rental-booking-effective-settlement-source-contract.test.mjs` protects the protected read boundary.
- `scripts/rental-booking-effective-refund-source-contract.test.mjs` protects persistence, database source caps, tenant/manual-reference isolation, writer permissions/locking/provider usage, bounded history, and the no-UI boundary.
- Full repository validation remains `npm run validate` under the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
