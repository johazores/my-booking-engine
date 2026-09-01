# Booking management

SF has an authenticated booking-management surface at `/bookings/[booking-id]` over the existing tenant-safe booking and payment boundaries. It supports production-safe date rescheduling and cancellation in addition to booking/payment detail reads.

## Security and tenant scope

The page requires a valid authenticated session and active organization context. Booking retrieval uses `getHospitalityBooking`, which requires `booking:read` and selects the booking by both booking ID and organization ID. Cross-tenant or unavailable booking identifiers therefore resolve as unavailable instead of exposing another tenant's booking data.

Payment history and receipt data continue through their existing server services and `payment:read` authorization. Internal Stripe `sf_claim_*` operation references are never rendered as provider references.

Cancellation and rescheduling use separate server services and same-origin authenticated POST boundaries. Both derive the active organization and actor from the server session, require `booking:manage`, and re-read the tenant-owned booking inside their transaction. The browser never supplies organization ownership, current payment truth, inventory truth, or persisted pricing truth.

## Detail surface

The booking view presents persisted production data only:

- booking status, payment status, stay dates, quantity, confirmation timestamp, and cancellation timestamp;
- tenant-owned customer data and immutable ordered guest snapshots;
- room type and rate plan;
- immutable accommodation, tax, fee, add-on, and total price snapshots plus the persisted pricing fingerprint;
- persisted selected add-on data;
- paginated payment-ledger history for the booking;
- payment-receipt settlement details when the existing receipt service proves a successful settled payment;
- a real date-reschedule form for confirmed bookings;
- cancellation state and the real cancellation action when the booking/payment state permits it.

Bookings without payment activity show an explicit empty state. Bookings that are not yet eligible for a receipt show the actual receipt-domain reason rather than a fake receipt or success document.

## Reschedule contract

`POST /api/bookings/hospitality/[booking-id]/reschedule` changes arrival and departure dates only. Room type, rate plan, quantity, guest snapshots, add-on selections, payment records, and the persisted monetary price snapshot are not browser-editable.

The write serializes on a booking-specific advisory lock and the same room-type allocation lock used by availability and hold workflows. Inside that transaction it:

1. requires a confirmed tenant-owned booking with a retained allocation;
2. validates the requested calendar range and durable idempotency key;
3. checks active room/rate-plan assignment;
4. re-evaluates stay restrictions;
5. recalculates capacity while explicitly excluding the booking's own allocation, preventing false capacity failures for overlapping date changes;
6. re-quotes current rates, taxes, fees, and selected add-ons from persisted configuration;
7. requires currency and every persisted monetary subtotal/total to remain identical;
8. atomically updates the booking dates and allocation dates;
9. records the before/after stay, total, payment state, and request idempotency key in the audit trail without guest PII.

A reschedule that changes accommodation, tax, fee, add-on, total, or currency fails closed before mutation. SF does not silently rewrite the original commercial price snapshot and does not implicitly charge or refund a difference. Non-zero payment deltas require a dedicated payment-adjustment workflow before that broader modification class can be enabled.

The current date-only workflow is safe for already-paid bookings because it never changes the amount represented by the payment ledger. Provider references and card/payment credentials are untouched.

### Reschedule idempotency

The audit ledger is also the persisted request ledger for completed reschedules. Reusing an idempotency key with different requested dates is rejected. Replaying the same completed request returns successfully only while those dates remain the current booking state; if a later reschedule has superseded it, the stale replay fails closed instead of moving the booking backward.

## Cancellation contract

Cancellation is a retained lifecycle transition, not deletion. `CONFIRMED -> CANCELLED` uses the existing booking state machine and stores `cancelledAt`; the booking, immutable guest/price snapshots, allocation record, payment ledger, and audit history remain available after cancellation.

Cancellation acquires both a booking-specific advisory lock and the same room-type allocation lock used by availability/hold workflows. Availability already excludes allocations whose booking is `CANCELLED`, so committing the booking status transition safely releases that inventory without deleting the historical allocation row.

The cancellation write is naturally idempotent for the current no-payload contract: retrying an already-cancelled booking returns the retained cancelled record and does not emit another audit event.

Payment state is resolved server-side before cancellation:

- `UNPAID`, `FAILED`, and fully `REFUNDED` bookings may be cancelled;
- `AUTHORIZED` bookings are blocked until the authorization is released or otherwise resolved;
- `PAID` and `PARTIALLY_REFUNDED` bookings are blocked until the required refund completes.

This deliberately prevents cancellation from releasing inventory while SF still has unresolved customer funds. The UI derives the same blocker reason from the shared domain policy but the server remains authoritative.

The booking detail page uses a two-step cancellation confirmation state with explicit confirm/keep actions, disabled submission state, error feedback, and post-success refresh. No destructive action is exposed when payment state makes cancellation unsafe.

## Validation coverage

Dependency-free booking-domain tests cover cancellation payment policy plus reschedule input normalization, invalid date/idempotency rejection, and zero-commercial-delta comparison across every persisted monetary field.

The guarded PostgreSQL reschedule scenario is checked into `npm run test:database` and covers `booking:manage` denial, cross-tenant denial, overlapping-date self-allocation exclusion, booking/allocation mutation, exact retry without duplicate audit events, changed-key payload rejection, non-zero price-delta rejection without mutation, held-inventory rejection, stale replay protection after a later change, and audit history without guest PII.

Database execution remains required against an explicitly confirmed disposable PostgreSQL target before those database/concurrency acceptance criteria can be marked complete. Full repository validation remains subject to the Node 24 `npm run validate` gate.

## Remaining booking-management work

General booking modification remains broader than the current date-only reschedule. Room type, rate plan, room quantity, guest edits, add-on edits, and any change that creates a non-zero payment delta need explicit version/history and payment-adjustment contracts before UI controls are exposed.

Invoice-generation and jurisdiction-specific tax-document issuance also remain separate commercial requirements rather than being implied by the current payment receipt foundation.
