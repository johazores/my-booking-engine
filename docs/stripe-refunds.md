# Stripe Refunds

SF issues Stripe refunds only through the server-side payment application boundary. The browser never supplies authoritative money, provider credentials, or a Stripe PaymentIntent reference.

`refundStripeBookingPayment` requires `payment:manage`, validates tenant-owned booking scope, and only accepts confirmed bookings whose payment state is `PAID` or `PARTIALLY_REFUNDED`. The refundable source must be a successful tenant-owned Stripe capture whose currency and exact minor-unit amount match the immutable booking total.

Refund amounts are exact integer minor units. Omitting `amountMinor` means refund the remaining refundable balance. Partial and full refunds are supported, and previously successful refunds are subtracted before a new provider operation can be claimed. A pending Stripe refund blocks a second refund for the booking until the first operation is resolved, preventing an ambiguous provider result from producing an over-refund.

Before calling Stripe, SF persists a tenant-scoped `PENDING` refund claim under the normal idempotency and booking advisory locks. Exact unresolved retries reuse the same Stripe idempotency key. Different concurrent refund requests cannot both cross the provider boundary. Definitive provider failures mark the claim failed; retryable transport/time-out failures remain pending rather than being falsely reported as failed or refunded.

Provider results are accepted only when the provider code, source PaymentIntent reference, currency, and amount match the claimed operation. Stripe refund references must have the expected `re_` form and cannot be reused by another transaction in the tenant. Provider-proven successful refunds update the booking to `PARTIALLY_REFUNDED` or `REFUNDED`; pending and failed results do not claim refunded money.

`POST /api/payments/stripe/refunds` exposes the authenticated same-origin management boundary. The request contains `bookingId`, `idempotencyKey`, and optional `amountMinor`. BigInt amounts are serialized through the shared payment HTTP boundary.

The refund audit trail records only safe commercial context: booking ID, provider code, operation kind/status, currency, amount, and resulting booking payment status. It does not record Stripe API secrets, webhook secrets, PaymentIntent IDs, refund IDs, card data, or browser payment-method references.

Current limitation: a Stripe refund that remains provider-side `PENDING` is persisted conservatively and blocks additional refunds. Provider-truth refund reconciliation or verified refund webhook finalization must be added before the online refund workflow is considered fully complete. The existing PaymentIntent reconciliation path must not be reused for refund objects.

The standard payment unit-test glob includes the Stripe refund domain tests. PostgreSQL locking/idempotency behavior still requires execution through the guarded disposable database suite before database validation is claimed.
