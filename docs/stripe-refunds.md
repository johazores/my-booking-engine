# Stripe Refunds

SF issues Stripe refunds only through the server-side payment application boundary. The browser never supplies authoritative money, provider credentials, or a Stripe PaymentIntent reference.

`refundStripeBookingPayment` requires `payment:manage`, validates tenant-owned booking scope, and only accepts confirmed bookings whose payment state is `PAID` or `PARTIALLY_REFUNDED` for a new refund. Exact idempotent retries remain readable after the booking reaches `REFUNDED`, while changed retries are rejected.

For the currently enabled Stripe refund path, the refundable source must be a successful tenant-owned Stripe capture whose currency and exact minor-unit amount match the immutable booking total. Refund amounts are exact integer minor units. Omitting `amountMinor` means refund the remaining refundable balance. Explicit-amount and refund-remaining requests use distinct request fingerprints so the same idempotency key cannot silently change intent.

Partial and full refunds are supported, and previously successful refunds are subtracted before a new provider operation can be claimed. A pending Stripe refund blocks a second refund for the booking until the first operation is resolved, preventing an ambiguous provider result from producing an over-refund.

Before calling Stripe, SF persists a tenant-scoped `PENDING` refund claim under the normal idempotency and booking advisory locks. The claim also persists `sourceProviderReference`, binding the refund to the exact successful Stripe settlement source before any external provider write occurs. Exact unresolved retries reuse the same Stripe idempotency key. Different concurrent refund requests cannot both cross the provider boundary. Definitive provider failures mark the claim failed; retryable transport/time-out failures remain pending rather than being falsely reported as failed or refunded.

Provider results are accepted only when the provider code, source PaymentIntent reference, currency, and amount match the claimed operation. Stripe refund references must have the expected `re_` form and cannot be reused by another transaction in the tenant. Provider-proven successful refunds update the booking to `PARTIALLY_REFUNDED` or `REFUNDED`; pending and failed results do not claim refunded money.

The shared settlement reconciler consumes persisted refund-source attribution. A successful refund must resolve to an effective successful settlement source from the same provider and cannot exceed that source's remaining settled money. Legacy refund rows without attribution are accepted only when there is exactly one effective source for that provider; legacy multi-source histories fail closed rather than guessing.

The shared `deriveBookingRefundExecutionPlan` now defines which source and source-scoped amount a future multi-source Stripe refund must use, along with the resulting whole-booking payment state. That does **not** by itself make multiple Stripe sources safe to refund. `refundStripeBookingPayment`, retry handling, read-only refund reconciliation, and verified refund webhook finalization still contain single-source assumptions and therefore the general staff action remains closed when more than one refundable Stripe source exists. Those boundaries must be upgraded together so an ambiguous external result always recovers against the exact persisted source.

`POST /api/payments/stripe/refunds` exposes the authenticated same-origin management boundary. The request contains `bookingId`, `idempotencyKey`, and optional `amountMinor`. BigInt amounts are serialized through the shared payment HTTP boundary.

## Provider-truth refund reconciliation

`POST /api/payments/stripe/refunds/reconcile` reconciles a tenant-owned `PENDING` Stripe refund that already has a real `re_` provider reference. The authenticated caller supplies only the SF payment transaction ID; tenant scope and Stripe credentials are resolved server-side and `payment:manage` remains mandatory.

The refund reconciliation adapter uses Stripe's read-only `GET /v1/refunds/:id` endpoint, so reconciliation never replays a refund write. SF verifies the returned refund ID, source PaymentIntent, exact currency, and exact minor-unit amount against the persisted refund and successful capture before accepting provider state.

Only Stripe `succeeded` proves that refunded money can be counted. `failed` and `canceled` close the ledger row as failed without changing the booking payment state. Other provider states remain `PENDING` and continue to block another refund. Successful reconciliation recalculates the accumulated successful refund total under the tenant booking lock and moves the booking to `PARTIALLY_REFUNDED` or `REFUNDED` without allowing a fully refunded booking to regress.

## Verified refund webhook finalization

The existing tenant-specific `POST /api/webhooks/stripe/[organization-id]` endpoint handles Stripe `refund.*` event objects in addition to PaymentIntent events. The original raw payload is signature-verified before JSON parsing, and the same tenant/provider event ledger provides duplicate suppression and altered-event conflict detection.

Refund callbacks do not rely on browser redirects or untrusted booking metadata. SF derives the booking from a successful tenant-owned Stripe capture whose provider reference matches the refund object's `payment_intent`, then takes the booking advisory lock and revalidates the source capture, confirmed booking, immutable booking currency/total, refund currency, and exact minor-unit refund amount.

For a pending refund, SF prefers an exact persisted `re_` provider reference. If the provider call ended ambiguously before the refund reference was persisted, a single matching internal `sf_claim_*` refund can acquire the verified callback's real refund reference. Multiple matching internal claims fail closed rather than guessing. A refund reference already owned by another transaction in the tenant is rejected. New refund claims retain their source settlement reference while the external refund ID/status is reconciled.

The callback reuses the same refund provider-state mapping as polling: `succeeded` becomes `SUCCEEDED`, `failed`/`canceled` become `FAILED`, and non-final provider states remain `PENDING`. Successful callbacks recalculate cumulative successful refunds under the booking lock and move payment state to `PARTIALLY_REFUNDED` or `REFUNDED`; a fully refunded booking cannot regress. Failed or pending callbacks do not claim refunded money.

Webhook persistence stores only the safe event ID/type/hash, refund provider reference, derived booking ID, processing status/note, and timestamps. Raw request bodies, API keys, webhook secrets, card data, PaymentIntent references, and refund references are not copied into audit events.

The refund audit trail records only safe commercial context: booking ID, provider code, operation kind/status, currency, amount, provider status, and resulting booking payment status. It does not record Stripe API secrets, webhook secrets, PaymentIntent IDs, refund IDs, card data, or browser payment-method references.

The standard payment unit-test coverage includes Stripe refund domain, reconciliation, webhook-domain, settlement-source attribution, refund allocation/execution planning, and refund-availability behavior: exact minor-unit parsing, provider-result mapping, partial/full balance transitions, over-refund rejection, explicit-versus-remaining request fingerprints, read-only refund retrieval, provider-state mapping, source/money mismatch rejection, refund-object parsing, exact-reference preference, internal-claim binding, ambiguity/money mismatch rejection, per-source balance reconciliation, deterministic source selection, and legacy multi-source fail-closed behavior.

The guarded PostgreSQL runner includes `stripe-refund-webhook.integration.ts`. That checked-in scenario verifies a signed refund callback can bind an internal pending claim to the real refund reference, finalize the refund and booking payment state, remain idempotent on exact redelivery, and reject reuse of the same event ID with altered signed content.

The PostgreSQL suite must still be **executed** against an explicitly confirmed disposable target before locking, migration, webhook concurrency, or database-level refund validation is claimed as passed. Broader production webhook operational validation also remains open. Browser redirects are never proof of payment or refund finality.
