# Commercial booking price-adjustment preview

SF now exposes an authenticated, tenant-scoped price-impact review step for hospitality commercial modifications before any write is attempted.

## Implemented boundary

`POST /api/bookings/hospitality/[booking-id]/modify/preview` accepts the same normalized room type, rate plan, room quantity, add-on selections, and booking idempotency key used by the existing commercial modification write.

The server derives organization and actor authority from the authenticated request context and requires `booking:manage`. It serializes the read on the shared tenant-and-booking advisory lock, re-reads the tenant-owned confirmed booking and retained allocation, rejects unresolved `PENDING` or `AMBIGUOUS` authorization/capture activity, validates the active target room/rate assignment and current traveler occupancy, and recalculates the requested commercial terms from current persisted pricing.

The preview never trusts browser-supplied current price, tenant identity, payment state, or existing booking monetary fields.

## Exact adjustment contract

The preview compares immutable current booking money with the current proposed quote using integer minor units only. It returns:

- exact current and proposed accommodation, tax, fee, add-on, and grand-total amounts;
- a signed grand-total delta;
- `NONE`, `ADDITIONAL_CHARGE`, or `REFUND` direction;
- the booking `updatedAt` timestamp as the reviewed booking version;
- the canonical commercial-selection fingerprint;
- a deterministic SHA-256 adjustment fingerprint over version, selection, before/after price snapshots, and component deltas; and
- customer/staff-safe display amounts derived server-side from the tenant currency.

The domain rejects malformed minor-unit values, internally inconsistent component totals, invalid pricing fingerprints, and cross-currency comparisons.

## Execution rules

The preview is deliberately not a payment or inventory mutation. It does not reserve target inventory, create an amendment, charge a payment method, issue a refund, rewrite payment status, or alter the booking.

When the reviewed delta is exactly zero, the booking-detail UI exposes the existing real commercial modification action. That write remains authoritative and repeats inventory, restriction, occupancy, unresolved-payment, and current-pricing checks inside its serializable transaction before changing the booking/allocation.

When the delta is non-zero, the UI presents the exact additional-charge or refund impact but does not expose an executable apply action. This avoids a fake or unsafe workflow while the durable amendment/payment-adjustment lifecycle is still incomplete.

## Remaining payment-adjustment work

A production non-zero commercial modification still needs durable amendment persistence and orchestration covering target inventory protection, immutable before/after terms, charge/refund intent, provider execution, payment-state transitions, exact retry semantics, ambiguous outcomes, crash recovery, cancellation/expiry, and final booking/payment reconciliation.

The existing Phase 13 general price-changing commercial modification checklist item must remain open until that lifecycle is implemented and validated. This preview is the authoritative preflight contract for that future work, not a claim that the payment adjustment itself is complete.

## Validation

Dependency-free domain tests cover zero-delta, additional-charge, refund, cross-currency rejection, deterministic/version-sensitive fingerprints, large exact minor-unit arithmetic without JavaScript number conversion, and inconsistent monetary snapshot rejection.

Full repository typecheck/lint/build and PostgreSQL integration execution still require the repository Node 24 toolchain and a confirmed disposable PostgreSQL target.
