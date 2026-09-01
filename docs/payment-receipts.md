# Payment receipts

SF exposes a read-only payment receipt foundation for confirmed hospitality bookings that have proven successful payment state. The receipt is derived from immutable booking price snapshots plus persisted successful payment/refund ledger rows; it does not create a second money source of truth.

## Security and tenant scope

`getBookingPaymentReceipt` requires `payment:read`, validates organization/user/booking identifiers, and selects the booking by `(bookingId, organizationId)`. The caller never supplies organization identity through the receipt payload. Cross-tenant booking IDs therefore resolve as unavailable rather than leaking receipt data.

The endpoint is `GET /api/payments/receipt?bookingId=...` and uses the same authenticated active-organization payment API context as transaction history.

## Receipt semantics

A receipt is available only for confirmed bookings whose payment state is `PAID`, `PARTIALLY_REFUNDED`, or `REFUNDED`. Pending, unpaid, authorized-only, and failed bookings cannot produce a successful-payment receipt.

The response contains:

- a deterministic receipt number derived from the booking UUID;
- tenant business/contact identity;
- customer identity already attached to the booking;
- stay dates, room type, rate plan, quantity, currency, and immutable accommodation/tax/fee/add-on/total snapshots;
- successful payment/refund ledger activity in chronological order;
- captured, refunded, and net-paid totals calculated with integer minor units.

Authorization rows are shown as payment history but are not counted as captured money. Captured Stripe payments and real offline payments contribute to captured money; successful refunds reduce the net settlement total. Pending and failed provider operations are excluded from receipt settlement proof.

Internal `sf_claim_*` references are never returned as provider references. The receipt API uses the standard payment JSON serializer so BigInt money is returned as decimal strings.

## Explicit non-goals

This is a payment-receipt/document foundation, not a jurisdiction-specific tax invoice engine. SF does not currently invent invoice numbers, tax-registration fields, legal fiscal wording, PDF generation, email delivery, or accounting-system synchronization. Those requirements must be added from real tenant/jurisdiction requirements rather than presented as complete.

The receipt also never treats a browser redirect as payment evidence. It can only be produced from persisted server-side payment state that came through manual recording or verified provider processing/reconciliation/webhooks.

## Validation

Focused dependency-free tests cover deterministic receipt numbering and settlement math, including authorization exclusion, captured payments, offline payments, and refunds. Full repository and PostgreSQL validation remain subject to the normal local `npm run validate` and explicitly confirmed disposable `npm run test:database` gates.
