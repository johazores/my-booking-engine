# Stripe Refunds

SF issues Stripe refunds only through the server-side payment application boundary. The browser never supplies authoritative money, provider credentials, or a Stripe PaymentIntent reference.

`refundStripeBookingPayment` requires `payment:manage`, validates tenant-owned booking scope, and only accepts confirmed bookings whose payment state is `PAID` or `PARTIALLY_REFUNDED` for a new refund. Exact idempotent retries remain readable after the booking reaches `REFUNDED`, while changed retries are rejected.

The refundable source must be a successful tenant-owned Stripe capture whose currency and exact minor-unit amount match the immutable booking total. Refund amounts are exact integer minor units. Omitting `amountMinor` means refund the remaining refundable balance. Explicit-amount and refund-remaining requests use distinct request fingerprints so the same idempotency key cannot silently change intent.

Partial and full refunds are supported, and previously successful refunds are subtracted before a new provider operation can be claimed. A pending Stripe refund blocks a second refund for the booking until the first operation is resolved, preventing an ambiguous provider result from producing an over-refund.

Before calling Stripe, SF persists a tenant-scoped `PENDING` refund claim under the normal idempotency and booking advisory locks. Exact unresolved retries reuse the same Stripe idempotency key. Different concurrent refund requests cannot both cross the provider boundary. Definitive provider failures mark the claim failed; retryable transport/time-out failures remain pending rather than being falsely reported as failed or refunded.

Provider results are accepted only when the provider code, source PaymentIntent reference, currency, and amount match the claimed operation. Stripe refund references must have the expected `re_` form and cannot be reused by another transaction in the tenant. Provider-proven successful refunds update the booking to `PARTIALLY_REFUNDED` or `REFUNDED`; pending and failed results do not claim refunded money.

`POST /api/payments/stripe/refunds` exposes the authenticated same-origin management boundary. The request contains `bookingId`, `idempotencyKey`, and optional `amountMinor`. BigInt amounts are serialized through the shared payment HTTP boundary.

## Provider-truth refund reconciliation

`POST /api/payments/stripe/refunds/reconcile` reconciles a tenant-owned `PENDING` Stripe refund that already has a real `re_` provider reference. The authenticated caller supplies only the SF payment transaction ID; tenant scope and Stripe credentials are resolved server-side and `payment:manage` remains mandatory.

The refund reconciliation adapter uses Stripe's read-only `GET /v1/refunds/:id` endpoint, so reconciliation never replays a refund write. SF verifies the returned refund ID, source PaymentIntent, exact currency, and exact minor-unit amount against the persisted refund and successful capture before accepting provider state.

Only Stripe `succeeded` proves that refunded money can be counted. `failed` and `canceled` close the ledger row as failed without changing the booking payment state. Other provider states remain `PENDING` and continue to block another refund. Successful reconciliation recalculates the accumulated successful refund total under the tenant booking lock and moves the booking to `PARTIALLY_REFUNDED` or `REFUNDED` without allowing a fully refunded booking to regress.

Internal `sf_claim_*` rows still cannot be guessed by polling because no Stripe refund ID is known yet. They require an exact idempotent retry or a future verified refund webhook that can bind the claim to a real refund object.

The refund audit trail records only safe commercial context: booking ID, provider code, operation kind/status, currency, amount, provider status, and resulting booking payment status. It does not record Stripe API secrets, webhook secrets, PaymentIntent IDs, refund IDs, card data, or browser payment-method references.

The standard payment unit-test glob includes Stripe refund domain and refund-reconciliation coverage for exact minor-unit parsing, provider-result mapping, partial/full balance transitions, over-refund rejection, explicit-versus-remaining request fingerprints, read-only refund retrieval, provider-state mapping, and source/money mismatch rejection. The guarded PostgreSQL runner also includes `stripe-refund.integration.ts`, covering permission and tenant denial, exact/changed retries, partial/full refunds, remaining-balance enforcement, concurrent pending-refund suppression, and audit reference/secret minimization.

The PostgreSQL suite must still be executed against an explicitly confirmed disposable target before locking, migration, or database-level refund validation is claimed as passed. Verified refund-object webhook finalization and broader production webhook operational validation remain open; do not treat browser redirects as proof of payment or refund finality.
