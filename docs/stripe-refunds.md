# Stripe Refunds

SF issues Stripe refunds only through the server-side payment application boundary. The browser never supplies authoritative money, provider credentials, or a Stripe PaymentIntent reference.

`refundStripeBookingPayment` requires `payment:manage`, validates tenant-owned booking scope, and only accepts confirmed bookings whose payment state is `PAID` or `PARTIALLY_REFUNDED` for a new refund. Exact idempotent retries remain readable after the booking reaches `REFUNDED`, while changed retries are rejected.

Refund authority comes from the full tenant-owned payment ledger. `deriveBookingRefundExecutionPlan` reconciles net settled money, deterministically selects the next refundable Stripe settlement source, calculates the source-scoped operation amount, and derives the resulting whole-booking payment status. Multiple successful Stripe settlement sources are supported sequentially; one refund operation never silently spans sources.

Refund amounts are exact integer minor units. Omitting `amountMinor` means refund the selected source's remaining balance. An explicit amount cannot exceed that source's remaining balance. Explicit-amount and refund-remaining requests use distinct request fingerprints so the same idempotency key cannot silently change intent.

Before calling Stripe, SF persists a tenant-scoped `PENDING` refund claim under the idempotency, booking mutation, and booking payment advisory locks. The claim persists `sourceProviderReference`, binding the refund to the exact successful Stripe settlement source before any external provider write occurs. Exact unresolved retries reuse the same Stripe idempotency key and must re-derive the same authoritative source/amount allocation before the provider call can be replayed. Different concurrent refund requests cannot both cross the provider boundary.

Definitive provider failures mark an internal claim failed; retryable transport/time-out failures remain pending rather than being falsely reported as failed or refunded. A legacy pending Stripe refund that lacks persisted source attribution fails closed for operator reconciliation rather than guessing which settlement it reduced.

Provider results are accepted only when the provider code, persisted source PaymentIntent reference, currency, and amount match the claimed operation. Stripe refund references must have the expected `re_` form and cannot be reused by another transaction in the tenant. Provider-proven successful refunds update booking payment state from the complete reconciled settlement ledger, not from one source's local refund total. Pending and failed results do not claim refunded money.

The shared settlement reconciler consumes persisted refund-source attribution. A successful refund must resolve to an effective successful settlement source from the same provider and cannot exceed that source's remaining settled money. Legacy refund rows without attribution are accepted only when there is exactly one effective source for that provider; legacy multi-source histories fail closed rather than guessing.

`POST /api/payments/stripe/refunds` exposes the authenticated same-origin management boundary. The request contains `bookingId`, `idempotencyKey`, and optional `amountMinor`. The browser cannot provide `sourceProviderReference`; SF selects it from authoritative settlement state. BigInt amounts are serialized through the shared payment HTTP boundary.

## Provider-truth refund reconciliation

`POST /api/payments/stripe/refunds/reconcile` reconciles a tenant-owned `PENDING` Stripe refund that already has a real `re_` provider reference. The authenticated caller supplies only the SF payment transaction ID; tenant scope and Stripe credentials are resolved server-side and `payment:manage` remains mandatory.

The refund reconciliation adapter uses Stripe's read-only `GET /v1/refunds/:id` endpoint, so reconciliation never replays a refund write. SF verifies the returned refund ID, source PaymentIntent, exact currency, and exact minor-unit amount against the persisted refund. It then re-reads the full booking ledger under the booking mutation/payment lock, excludes only the unresolved refund being reconciled, and requires the shared execution plan to select the same persisted source and amount.

Only Stripe `succeeded` proves that refunded money can be counted. `failed` and `canceled` close the ledger row as failed without changing booking payment state. Other provider states remain `PENDING` and continue to block another refund. Successful reconciliation derives `PAID`, `PARTIALLY_REFUNDED`, or `REFUNDED` from whole-booking net settlement after the refund is applied and rejects any result that disagrees with the pre-finalization execution plan.

## Verified refund webhook finalization

The tenant-specific `POST /api/webhooks/stripe/[organization-id]` endpoint handles Stripe `refund.*` event objects in addition to PaymentIntent events. The original raw payload is signature-verified before JSON parsing, and the same tenant/provider event ledger provides duplicate suppression and altered-event conflict detection.

Refund callbacks do not rely on browser redirects or untrusted booking metadata. SF resolves the tenant-owned booking from the successful Stripe settlement whose provider reference matches the refund object's `payment_intent`, requires that source reference to identify only one booking, and acquires both the booking mutation lock and payment booking lock before mutation.

For a pending refund, SF prefers an exact persisted `re_` provider reference. If the provider call ended ambiguously before the refund reference was persisted, only an internal claim already bound to the callback's exact `payment_intent` source and matching exact money can acquire the verified callback's real refund reference. An exact refund reference with a different persisted source is rejected. Multiple matching claims fail closed rather than guessing, and a refund reference already owned by another transaction in the tenant is rejected.

Before accepting provider state, the callback re-reads the full tenant booking ledger, excludes the current unresolved refund, and requires the shared refund execution plan to select the same source, amount, and currency. This keeps verified webhook recovery aligned with direct writes and polling even when a booking has multiple successful Stripe settlement sources.

The callback reuses the same refund provider-state mapping as polling: `succeeded` becomes `SUCCEEDED`, `failed`/`canceled` become `FAILED`, and non-final provider states remain `PENDING`. Successful callbacks derive booking payment state from whole-booking net settlement after the refund and require it to match the planned next state. Failed or pending callbacks do not claim refunded money.

Webhook persistence stores only the safe event ID/type/hash, refund provider reference, derived booking ID, processing status/note, and timestamps. Raw request bodies, API keys, webhook secrets, card data, PaymentIntent references, and refund references are not copied into audit events.

The refund audit trail records safe commercial context including booking ID, provider code, operation kind/status, currency, amount, persisted settlement-source attribution, provider status where applicable, and resulting booking payment status. It does not record Stripe API secrets, webhook secrets, card data, or browser payment-method references.

## Validation

The standard payment unit-test coverage includes Stripe refund domain, reconciliation, webhook-domain, settlement-source attribution, refund allocation/execution planning, whole-booking refund-state reconciliation, and refund-availability behavior. Coverage includes exact minor-unit parsing, provider-result mapping, read-only refund retrieval, provider-state mapping, source/money mismatch rejection, refund-object parsing, exact-reference preference, internal-claim binding, ambiguity/money mismatch rejection, per-source balance reconciliation, deterministic source selection, multi-source progression, and legacy multi-source fail-closed behavior.

The guarded PostgreSQL runner includes `stripe-refund-webhook.integration.ts`. Its existing signed-callback scenario verifies provider-reference binding, finalization, exact-redelivery idempotency, and altered-event rejection. Source-aware multi-settlement behavior now exists in the application boundaries but still requires the disposable PostgreSQL suite to be executed, and the integration scenario should be expanded when the database test environment is available to exercise two successful Stripe settlements end to end.

The PostgreSQL suite must still be **executed** against an explicitly confirmed disposable target before locking, migration, webhook concurrency, or database-level refund validation is claimed as passed. Broader production webhook operational validation also remains open. Browser redirects are never proof of payment or refund finality.
