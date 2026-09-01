# Payments

SF keeps booking state and payment state separate. Provider-specific behavior remains behind normalized payment adapters; application services own tenant scope, authorization, idempotency, persistence, booking-state changes, and audit history.

## Provider contract

`src/server/payments/payment-provider.ts` defines explicit capabilities for offline recording, offline refunds, authorization, capture, refunds, and webhooks. Money is represented as exact integer minor units with an explicit three-letter currency. Online authorization accepts only provider-issued payment-method references; SF never accepts raw card data through this server contract.

The manual provider records real offline payments/refunds that already happened outside SF. It does not pretend to process cards or move funds.

## Stripe adapter

`StripePaymentProvider` is the first real online adapter. Tenant credentials are loaded only from the encrypted integration boundary. Stripe authorization creates confirmed PaymentIntents using manual capture, exact booking money, tenant/booking metadata, and the SF idempotency key. Capture and refund calls use the persisted PaymentIntent reference. Provider failures are normalized, retryable transport/timeout conditions are treated as ambiguous, and webhook signature verification uses the original raw body plus Stripe's timestamped HMAC signature.

`StripePaymentReconciliationProvider` is a provider-specific read adapter for `GET /v1/payment_intents/:id`. It resolves persisted Stripe references without replaying a write, normalizes exact money/status fields, and keeps Stripe HTTP/auth/timeout behavior outside the booking domain.

There is intentionally no fake browser checkout route. A future public payment surface must use real client-side Stripe tokenization/PaymentMethod creation and must never trust a browser success redirect as proof of payment.

## Persisted transaction ledger

`PaymentTransaction` is tenant scoped and linked to the tenant-owned booking. It stores the operation kind/status, provider code/reference, exact money, request fingerprint where applicable, and a tenant-unique idempotency key. Provider references are indexed for reconciliation but are not globally unique across immutable attempt history.

Manual payment and refund writes serialize tenant idempotency, booking, and external reference scopes in PostgreSQL transactions. Booking payment state changes and audit events commit atomically with the ledger write.

## Stripe authorization/capture application boundary

`authorizeStripeBookingPayment` and `captureStripeBookingPayment` enforce `payment:manage`, tenant-owned booking access, immutable booking money, configured tenant integration capabilities, provider capability checks, exact request fingerprints, and booking/payment state transitions.

A provider call is claimed in the persisted payment ledger **before** the external Stripe request. The claim uses the normal tenant idempotency boundary plus the booking advisory lock, so two brand-new requests with different idempotency keys cannot both cross the provider boundary for the same authorization/capture lifecycle.

The claim lifecycle is intentionally conservative:

- the first request creates a `PENDING` ledger claim while holding the tenant booking lock, then releases the database transaction before calling Stripe;
- a different idempotency key sees that pending claim and is rejected before any second provider call;
- an exact retry of an unresolved pre-provider/ambiguous claim may retry Stripe with the **same** provider idempotency key so Stripe can return the original result safely;
- a normalized provider result replaces the internal claim marker with the real provider reference and persists the final/pending provider status;
- retryable/ambiguous transport failures leave the claim pending and block a different operation until exact retry or reconciliation resolves it;
- definitive non-retryable provider failures mark the claim failed, allowing a later new idempotency key where the booking state permits it;
- internal claim markers are never serialized as provider references through the payment HTTP boundary.

This removes the previous race where two different idempotency keys could both reach Stripe before either result was persisted, without holding a PostgreSQL transaction open across a network request.

## Stripe reconciliation

`reconcileStripePaymentTransaction` is an authorized server-side recovery boundary for persisted Stripe `PENDING` authorization/capture rows that already have a real PaymentIntent reference.

- `payment:manage` is required and the transaction is selected by `(transactionId, organizationId)`.
- Only Stripe `AUTHORIZATION` and `CAPTURE` rows can be reconciled.
- Internal `sf_claim_*` rows are never guessed; without a provider reference they require the exact idempotent retry or a verified webhook resolution path.
- SF retrieves the PaymentIntent through the Stripe read adapter and verifies provider reference, currency, and authoritative booking amount before changing state.
- `requires_capture` resolves authorization to `AUTHORIZED`; `succeeded` resolves exact full payment to `PAID`; provider states that do not prove finality stay `PENDING`.
- Definitive canceled/requires-payment-method states fail the relevant transaction without claiming a successful capture.
- The final ledger update, booking payment state transition, and reference-minimized audit event are serialized under the tenant booking lock.
- Already-final transactions are idempotent reads and do not contact Stripe again.

This is provider-truth reconciliation, not browser-success reconciliation.

## Stripe webhook ingestion

`POST /api/webhooks/stripe/[organization-id]` is the external Stripe callback boundary. It is deliberately not session-authenticated or same-origin protected because Stripe is the caller; authenticity is established by the tenant-specific encrypted webhook secret and the Stripe signature over the **original raw request body**.

Webhook processing follows a fail-closed, tenant-safe sequence:

- the route reads `request.text()` exactly once and passes the untouched string plus `Stripe-Signature` to the payment adapter before JSON parsing;
- the tenant Stripe integration must be active, advertise the `webhooks` capability, contain a valid webhook secret, and expose the provider `WEBHOOKS` capability;
- request size and signature-header bounds are enforced before persistence;
- only after signature verification does SF parse and normalize the Stripe event envelope and PaymentIntent fields;
- `PaymentWebhookEvent` stores the tenant/provider event ID, event type, SHA-256 payload hash, safe provider/booking references, processing status/note, and timestamps — never the raw webhook body, API secret, webhook secret, or card data;
- `(organizationId, providerCode, providerEventId)` is unique and an advisory event lock makes exact redelivery idempotent; reusing an event ID with different signed content is rejected as a conflict;
- PaymentIntent callbacks must carry the SF organization/booking metadata created during authorization, and that metadata must match the tenant endpoint, a confirmed tenant-owned booking, currency, and immutable booking total before payment state can change;
- only an already-persisted `PENDING` Stripe authorization/capture operation for that booking may be resolved; exact provider references are preferred, while an unambiguous internal `sf_claim_*` row can acquire its real PaymentIntent reference from the verified callback;
- payment status mapping and booking-state regression protection reuse the same reconciliation rules as provider-truth polling;
- unsupported event types, missing/mismatched SF metadata, unavailable bookings, money mismatches, and events with no matching pending payment are recorded as `IGNORED` and do not mutate payment state.

This persisted webhook ledger provides duplicate suppression and callback evidence without introducing a separate event service. The current modular-monolith implementation processes the small normalized state transition synchronously; a separate queue is not introduced without a demonstrated operational need.

## API boundary

- `POST /api/payments/manual` records a confirmed offline payment.
- `POST /api/payments/manual/refunds` records a confirmed offline refund.
- `POST /api/payments/stripe/reconcile` reconciles one tenant-owned pending Stripe authorization/capture transaction from Stripe provider truth.
- `POST /api/webhooks/stripe/[organization-id]` verifies and ingests tenant-specific Stripe callbacks from the raw request body.
- `GET /api/payments/transactions?bookingId=...` returns paginated tenant-scoped history.

BigInt money is serialized as decimal strings. Internal Stripe provider-call claim references are serialized as `null`, never as if they were real Stripe identifiers.

## Permissions

Organization `ADMIN` and `MANAGER` roles receive `payment:read` and `payment:manage`. `STAFF` receives `payment:read`. `CUSTOMER` receives no internal ledger capability. A future self-service payment surface must use a separate customer ownership boundary rather than weaken staff/admin permissions.

The Stripe webhook route does not reuse these interactive permissions: it has no user actor and can only operate after tenant-specific provider signature verification, tenant metadata matching, and tenant-owned booking/payment resolution.

## Validation and remaining work

The normal unit test glob includes payment-provider, Stripe-adapter, Stripe-persistence, HTTP serialization, Stripe reconciliation, and Stripe webhook-domain coverage. Webhook-domain coverage checks normalized signed-event fields, non-PaymentIntent event handling, malformed money rejection, invalid tenant metadata handling, exact provider-reference preference, pre-reference claim resolution, and ambiguous-candidate rejection.

The guarded disposable PostgreSQL suite remains the required validation target for real concurrency and migration verification. Stripe authorization/capture/reconciliation/webhook persistence still needs dedicated PostgreSQL execution for cross-tenant denial, exact retry, changed retry, simultaneous different-idempotency claims, pending/ambiguous retry behavior, definitive-failure reclaim, provider-reference ownership, successful capture, reconciliation locking/state transitions, duplicate webhook delivery, altered duplicate event rejection, internal-claim resolution, and callback tenant/money mismatch behavior.

Still open: customer-facing Stripe collection, online refund orchestration, receipts/invoices, PayPal, broader production webhook operational validation, and live PostgreSQL validation. Do not claim database validation passed unless `npm run test:database` runs against the explicitly confirmed disposable PostgreSQL target.
