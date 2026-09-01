# Booking management

SF has an authenticated booking-management surface at `/bookings/[booking-id]` over the existing tenant-safe booking and payment boundaries. It now supports production-safe booking cancellation in addition to booking/payment detail reads. Modification and rescheduling remain intentionally absent until their availability, pricing, and persistence rules are implemented.

## Security and tenant scope

The page requires a valid authenticated session and active organization context. Booking retrieval uses `getHospitalityBooking`, which requires `booking:read` and selects the booking by both booking ID and organization ID. Cross-tenant or unavailable booking identifiers therefore resolve as unavailable instead of exposing another tenant's booking data.

Payment history and receipt data continue through their existing server services and `payment:read` authorization. Internal Stripe `sf_claim_*` operation references are never rendered as provider references.

Cancellation uses a separate server service and `POST /api/bookings/hospitality/[booking-id]/cancel`. The write requires a same-origin authenticated request, an active tenant context, `booking:manage`, a tenant-owned booking ID, and the existing booking state transition contract. The browser never supplies organization ownership or payment truth.

## Detail surface

The booking view presents persisted production data only:

- booking status, payment status, stay dates, quantity, confirmation timestamp, and cancellation timestamp;
- tenant-owned customer data and immutable ordered guest snapshots;
- room type and rate plan;
- immutable accommodation, tax, fee, add-on, and total price snapshots plus the persisted pricing fingerprint;
- persisted selected add-on data;
- paginated payment-ledger history for the booking;
- payment-receipt settlement details when the existing receipt service proves a successful settled payment;
- cancellation state and the real cancellation action when the booking/payment state permits it.

Bookings without payment activity show an explicit empty state. Bookings that are not yet eligible for a receipt show the actual receipt-domain reason rather than a fake receipt or success document.

The recent-bookings table on `/bookings` links directly to this tenant-scoped detail page.

## Cancellation contract

Cancellation is a retained lifecycle transition, not deletion. `CONFIRMED -> CANCELLED` uses the existing booking state machine and stores `cancelledAt`; the booking, immutable guest/price snapshots, allocation record, payment ledger, and audit history remain available after cancellation.

Cancellation acquires both a booking-specific advisory lock and the same room-type allocation lock used by availability/hold workflows. Availability already excludes allocations whose booking is `CANCELLED`, so committing the booking status transition safely releases that inventory without deleting the historical allocation row.

The cancellation write is naturally idempotent for the current no-payload contract: retrying an already-cancelled booking returns the retained cancelled record and does not emit another audit event.

Payment state is resolved server-side before cancellation:

- `UNPAID`, `FAILED`, and fully `REFUNDED` bookings may be cancelled;
- `AUTHORIZED` bookings are blocked until the authorization is released or otherwise resolved;
- `PAID` and `PARTIALLY_REFUNDED` bookings are blocked until the required refund completes.

This deliberately prevents cancellation from releasing inventory while SF still has unresolved customer funds. The UI derives the same blocker reason from the shared domain policy but the server remains authoritative.

The booking detail page uses a two-step confirmation state with explicit confirm/keep actions, disabled submission state, error feedback, and post-success refresh. No destructive action is exposed when payment state makes cancellation unsafe.

## Validation coverage

The dependency-free cancellation-domain tests cover allowed and blocked payment states plus authorization/refund-specific operator guidance.

The checked-in PostgreSQL hospitality-booking integration scenario covers:

- `booking:manage` denial;
- cross-tenant booking denial;
- paid-booking cancellation blocking;
- successful cancellation and timestamp persistence;
- exact cancellation retry without duplicate audit events;
- released sellable inventory while the historical allocation remains retained;
- retained booking readability after cancellation;
- audit payload minimization without guest PII.

Full repository validation remains subject to the Node 24 `npm run validate` gate and the explicitly confirmed disposable PostgreSQL `npm run test:database` gate.

## Remaining booking-management work

The next booking-management lifecycle work is modification/rescheduling. Those operations must revalidate availability and complete persisted pricing under the allocation lock, preserve immutable commercial history, define change/idempotency semantics, and handle payment deltas explicitly before any UI action is exposed.

Invoice-generation and jurisdiction-specific tax-document issuance also remain separate commercial requirements rather than being implied by the current payment receipt foundation.
