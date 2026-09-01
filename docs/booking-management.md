# Booking management

SF now has an authenticated booking-detail management surface at `/bookings/[booking-id]`. It is a read-only production view over the existing tenant-safe booking and payment boundaries; it does not invent modification, cancellation, or payment actions that do not yet have completed server workflows.

## Security and tenant scope

The page requires a valid authenticated session and active organization context. Booking retrieval uses `getHospitalityBooking`, which requires `booking:read` and selects the booking by both booking ID and organization ID. Cross-tenant or unavailable booking identifiers therefore resolve as unavailable instead of exposing another tenant's booking data.

Payment history and receipt data continue through their existing server services and `payment:read` authorization. Internal Stripe `sf_claim_*` operation references are never rendered as provider references.

## Detail surface

The booking view presents persisted production data only:

- booking status, payment status, stay dates, quantity, and confirmation timestamp;
- tenant-owned customer data and immutable ordered guest snapshots;
- room type and rate plan;
- immutable accommodation, tax, fee, add-on, and total price snapshots plus the persisted pricing fingerprint;
- persisted selected add-on data;
- paginated payment-ledger history for the booking;
- payment-receipt settlement details when the existing receipt service proves a successful settled payment.

Bookings without payment activity show an explicit empty state. Bookings that are not yet eligible for a receipt show the actual receipt-domain reason rather than a fake receipt or success document.

The recent-bookings table on `/bookings` links directly to this tenant-scoped detail page.

## Explicit non-goals

This slice does not add modify, reschedule, cancel, refund, invoice-generation, or destructive actions. Those actions require their own state-machine, availability, payment/refund, audit, idempotency, and confirmation rules before UI controls are exposed.

## Validation

The page reuses already-covered booking, payment-history, and receipt service boundaries instead of duplicating business logic in React. Full repository validation remains subject to the Node 24 `npm run validate` gate and the explicitly confirmed disposable PostgreSQL `npm run test:database` gate.
