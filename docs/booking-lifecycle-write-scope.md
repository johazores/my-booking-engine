# Booking lifecycle write scope

This document records the final persistence boundary for the remaining core hospitality booking-state mutations reviewed together: same-price date rescheduling, booking cancellation, and manual/offline booking payment-state updates.

## Scope

The reviewed services are:

- `src/server/bookings/hospitality-booking-reschedule-service.ts`
- `src/server/bookings/hospitality-booking-cancellation-service.ts`
- `src/server/payments/payment-service.ts`

All three already authorize and tenant-scope the operation before mutation. This review closes the remaining gap where the final `HospitalityBooking` write could previously fall back to an ID-only predicate after stronger tenant, lifecycle, pricing, inventory, or settlement checks had already run.

## Same-price reschedule

The reschedule service still requires `booking:manage`, the shared tenant+booking advisory lock, the room-type allocation lock, a confirmed booking, no active commercial amendment, no unresolved payment operation, active room/rate assignment, current restrictions, current sellable capacity, exact persisted pricing equality, persisted pricing evidence, audit history, idempotent replay handling, and a serializable transaction.

The retained allocation must now also match the booking snapshot for organization, booking, property, room type, quantity, arrival date, and departure date before any mutation proceeds.

The final booking mutation repeats the authenticated organization, confirmed lifecycle, payment state, observed booking version, current commercial assignment, current stay, quantity, exact persisted money, and prior pricing fingerprint. The final allocation mutation repeats the tenant+booking composite plus the previously validated property, room type, stay dates, and quantity. A stale or mismatched snapshot therefore fails closed instead of being silently rebound by primary key.

## Cancellation

Cancellation remains a lifecycle transition to `CANCELLED`, not deletion. Existing active-amendment, booking-transition, payment-state, unresolved-payment, advisory-lock, audit, and serializable-transaction rules are preserved.

The final cancellation mutation now repeats the authenticated organization, validated prior booking status, validated payment state, observed booking version, current commercial assignment, stay, quantity, exact persisted money, and pricing fingerprint before setting `status = CANCELLED` and `cancelledAt`. This allows both valid source lifecycle states supported by the booking state machine while preventing stale state from being overwritten by an ID-only update.

## Manual payment and refund booking state

The manual provider continues to represent real externally completed payment/refund activity and remains behind the payment-provider contract. Tenant authorization, idempotency, provider-reference locking, exact money checks, source-aware refund planning, amendment blocking for refunds, audit history, and serializable transactions remain unchanged.

The final booking payment-state mutations now retain the authenticated organization, confirmed booking lifecycle, previously validated payment state, currency, and authoritative booking total. Recording the payment/refund ledger row therefore cannot silently update a booking whose commercial/payment identity changed between validation and mutation.

## Similar-issue sweep

The production `src/server` sweep for the historical exact pattern `hospitalityBooking.update({ where: { id: booking.id } ... })` identified these remaining booking-state writes. The cancellation, reschedule, and manual payment/refund occurrences are now scoped. Existing Stripe, commercial-amendment, public Checkout, and zero-delta commercial-modification boundaries already use stronger predicates from their dedicated reviews.

Test/integration fixtures may still use ID-only writes to create or perturb test state; those are not production mutation boundaries.

## Validation boundary

The dependency-free source contract in `scripts/booking-lifecycle-write-scope.test.mjs` protects the reviewed predicates and allocation-coherence rule from regressing to ID-only writes.

Full repository validation still requires the repository Node 24 toolchain and, for database behavior, an explicitly disposable PostgreSQL target. In environments without those dependencies, only checks actually executed may be claimed. GitHub Actions are intentionally not used for this repository.
