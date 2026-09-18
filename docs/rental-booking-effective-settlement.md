# Rental booking effective settlement

SF now has a protected **read-only** effective-settlement model for rental bookings. It reconciles the immutable original booking-price ledger with the one currently supported applied price-changing rental commercial amendment without rewriting either evidence stream.

This read model exists because `RentalBooking.totalMinor` intentionally remains the accepted booking-time snapshot after a commercial date amendment. Once an amendment is applied, later refund and cancellation decisions must use the effective accepted total and the retained amendment adjustment instead of pretending the original booking amount is still the complete commercial truth.

## Authority and tenant scope

`readRentalBookingEffectiveSettlement` validates organization, actor, and booking UUIDs, requires both `booking:read` and `payment:read`, and runs under `RepeatableRead`. The internal transaction reader always scopes the booking, applied amendment, original payment history, and amendment settlement rows by the same organization and booking.

Original booking-price evidence is read through the existing bounded `readRentalPaymentSettlementHistory` contract. The applied-amendment query reads at most two rows and fails reconciliation if more than one applied amendment exists even though the database already has a one-applied-amendment guard. Amendment settlement reads are likewise bounded and re-derive every retained request fingerprint before the evidence can contribute to an effective balance.

## Effective commercial math

Without an applied amendment, the read model is the existing reconciled booking-price settlement.

For the single supported applied amendment, the server verifies that:

- amendment currency equals booking currency;
- `beforeTotalMinor` equals the immutable original rental total;
- the positive delta exactly reconciles `beforeTotalMinor` and `afterTotalMinor` for the retained direction;
- the amendment settlement itself is exactly `SETTLED`, meaning one successful uncompensated manual adjustment with the expected kind, currency, amount, and source attribution.

An `ADDITIONAL_CHARGE` adds the retained amendment payment to the original booking-price net. The effective accepted total is `afterTotalMinor`. Refund-to-zero decomposition remains explicit: original booking-price money is one remainder and the amendment charge is a separate remainder because it lives in the amendment ledger.

A `REFUND` amendment is different. Its adjustment is already a real source-attributed refund against the original booking-price payment. The read model injects that retained adjustment into settlement reconciliation as a refund against its original source before calculating the current effective net. This prevents a future refund planner from treating already-refunded source money as still available.

The returned read model exposes the immutable original total, effective accepted total, original booking-price net, signed amendment effect, current combined net, exact refund amount still required before cancellation could be financially safe, and the split between booking-price refund remainder and applied-amendment charge refund remainder.

## Fail-closed behavior

Reconciliation fails rather than guessing when original payment history is incomplete, more than one applied amendment exists, terminal apply evidence is missing, amendment request fingerprints are invalid, settlement rows exceed the supported adjustment/compensation contract, currencies differ, commercial arithmetic is inconsistent, the amendment is not exactly settled, a decrease over-refunds its retained original source, or the resulting effective net falls outside zero through the effective accepted total.

The read model does not derive commercial truth from browser values and does not create provider actions.

## Current write boundary

This implementation does **not enable a post-apply refund**, does **not enable cancellation after an applied amendment**, and does not enable chained commercial amendments or reschedules. Existing PostgreSQL guards intentionally continue blocking those writes.

That boundary is important: reading an exact combined balance is not enough to make money movement safe. The next write contract must serialize the booking and both settlement streams, allocate refunds to the correct original or amendment payment source, retain deterministic idempotency/request evidence, preserve the tenant-wide manual-reference namespace, and update the database cancellation guard only after the same effective-total math is enforced independently in PostgreSQL.

Only one applied price-changing amendment per rental remains supported.

## Validation

- `src/server/bookings/rental-booking-effective-settlement-domain.test.ts` covers unchanged bookings, applied increases, applied decreases, later source refunds, arithmetic conflicts, compensation conflicts, and source over-refund rejection.
- `scripts/rental-booking-effective-settlement-source-contract.test.mjs` protects tenant scoping, permissions, bounded reads, retained request fingerprint verification, and the deliberately read-only product boundary.
- Full repository validation remains `npm run validate` on the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
