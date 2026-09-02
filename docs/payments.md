# Payments

SF keeps booking state and payment state separate. Provider-specific behavior remains behind normalized payment adapters; application services own tenant scope, authorization, idempotency, persistence, booking-state changes, and audit history.

## Provider contract

`src/server/payments/payment-provider.ts` defines explicit capabilities for offline recording, offline refunds, authorization, capture, refunds, and webhooks. Money is represented as exact integer minor units with an explicit three-letter currency. Online authorization accepts only provider-issued payment-method references; SF never accepts raw card data through this server contract.

The manual provider records real offline payments/refunds that already happened outside SF. It does not pretend to process cards or move funds.

## Stripe adapter

`StripePaymentProvider` is the first real online adapter. Tenant credentials are loaded only from the encrypted integration boundary. Stripe authorization creates confirmed PaymentIntents using manual capture, exact booking money, tenant/booking metadata, and the SF idempotency key. Capture and refund calls use persisted provider references. Provider failures are normalized, retryable transport/timeout conditions are treated as ambiguous, and webhook signature verification uses the original raw body plus Stripe's timestamped HMAC signature.

`StripePaymentReconciliationProvider` retrieves PaymentIntent provider truth without replaying writes. `StripeRefundReconciliationProvider` does the same for refund objects through Stripe's refund retrieval endpoint. Provider-specific HTTP/auth/timeout behavior stays outside the booking domain.

Public hospitality collection uses `StripeCheckoutProvider` through Stripe-hosted Checkout. SF sends only authoritative tenant-owned booking money, tenant/booking metadata, server-derived return URLs, and an optional customer email; raw card numbers/CVC never pass through SF. The public booking capability and request key remain outside return URLs, and browser redirects never establish payment truth. Signed Stripe webhook state and the capability-owned payment-status boundary remain authoritative.

## Persisted transaction ledger

`PaymentTransaction` is tenant scoped and linked to the tenant-owned booking. It stores the operation kind/status, provider code/reference, exact money, request fingerprint where applicable, a tenant-unique idempotency key, and nullable `sourceProviderReference` for refund-to-settlement-source attribution. Provider references are indexed for reconciliation but are not globally unique across immutable attempt history.

The source-attribution field is valid only for refund rows and is indexed by tenant/provider/source reference. New manual refunds persist the exact offline payment reference they reduce. New Stripe refund claims persist the exact successful PaymentIntent/capture reference before the provider call, so retries, provider reconciliation, and webhook finalization retain the original settlement-source identity. Existing historical refunds remain nullable to avoid inventing a destructive backfill.

Manual payment/refund and Stripe payment/refund writes serialize tenant idempotency, booking, and relevant provider-reference scopes in PostgreSQL transactions. Booking payment-state changes and audit events commit atomically with ledger writes where there is an authenticated actor. Provider webhooks use the dedicated persisted webhook-event ledger because there is no user actor.

Public hosted Checkout also persists `PaymentCheckoutSession`, binding the tenant, public principal, booking, payment claim, provider Session reference, lifecycle status, and provider expiry. This gives SF durable recovery evidence across browser/process restarts and allows signed Checkout completion/expiry callbacks to mutate only the exact tracked commercial operation.

## Authoritative booking settlement reconciliation

`deriveBookingSettlementSummary` is the shared pure-domain view of authoritative settled money for a booking. It operates only on the tenant-owned persisted ledger and exact integer minor units. Successful `OFFLINE_PAYMENT`, `CAPTURE`, and settled `AUTHORIZATION` records form gross settlement; a matching successful capture replaces its authorization in the calculation so the same PaymentIntent is not counted twice.

Successful refunds are now reconciled against the exact settlement source they reduced. Each source summary exposes gross source money, refunded money, and remaining money; provider and booking totals are derived from those source balances. A persisted `sourceProviderReference` must resolve to a successful effective source owned by the same provider, and source-level refunds cannot exceed source-level settled money.

For legacy rows, an unattributed successful refund is accepted only when its provider has exactly one effective settlement source, because that attribution is unambiguous. A legacy refund on a provider with multiple settlement sources fails closed instead of being spread or assigned arbitrarily. The summary also fails closed when any payment operation is still `PENDING` or `AMBIGUOUS`, successful money uses another currency, provider identity is missing, an internal `sf_claim_*` marker is incorrectly marked successful, provider references are duplicated, refund history has no matching source/provider, or source-level refunds exceed settled money.

Commercial amendment preparation uses the net settlement summary and currently requires the result to equal the authoritative booking total through exactly one supported provider (`manual` or `stripe`). Multiple same-provider sources are valid for reconciliation when refund attribution is unambiguous, which is required for repeat commercial adjustments. Mixed-provider history remains fail-closed for amendment execution until provider selection semantics are explicitly designed.

The general staff refund action remains intentionally stricter: it requires exactly one settlement source. SF now has the persistence and reconciliation primitive needed to know **where an existing refund landed**, but it still does not choose an arbitrary source or split a brand-new refund across multiple captures/offline payments. Deterministic source selection/splitting and provider execution remain a separate required boundary before multi-source histories can be refunded through the general action.

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

This avoids holding a PostgreSQL transaction open across a network request while still preventing two different idempotency keys from concurrently crossing the Stripe write boundary.

## Stripe payment reconciliation

`reconcileStripePaymentTransaction` is an authorized server-side recovery boundary for persisted Stripe `PENDING` authorization/capture rows that already have a real PaymentIntent reference.

- `payment:manage` is required and the transaction is selected by `(transactionId, organizationId)`.
- Only Stripe `AUTHORIZATION` and `CAPTURE` rows can be reconciled.
- Internal `sf_claim_*` rows are never guessed; without a provider reference they require the exact idempotent retry or a verified webhook resolution path.
- SF retrieves the PaymentIntent through the Stripe read adapter and verifies provider reference, currency, and authoritative booking amount before changing state.
- `requires_capture` resolves authorization to `AUTHORIZED`; `succeeded` resolves exact full payment to `PAID`; provider states that do not prove finality stay `PENDING`.
- Definitive canceled/requires-payment-method states fail the relevant transaction without claiming a successful capture.
- The final ledger update, booking payment-state transition, and reference-minimized audit event are serialized under the tenant booking lock.
- Already-final transactions are idempotent reads and do not contact Stripe again.

This is provider-truth reconciliation, not browser-success reconciliation.

## Stripe refund orchestration and reconciliation

`refundStripeBookingPayment` requires `payment:manage`, derives the source capture and money from tenant-owned persisted records, supports explicit partial amounts or the remaining refundable balance, and persists a `PENDING` refund claim before calling Stripe. The claim includes the exact source settlement provider reference. Successful refunds move the booking to `PARTIALLY_REFUNDED` or `REFUNDED`; failed or unresolved refunds never claim refunded money. Pending refunds serialize the refundable balance and block a second refund until the first one resolves.

Exact retries reuse the tenant idempotency key and Stripe idempotency key. Internal `sf_claim_*` references represent provider operations whose real refund ID is not known yet and are never exposed as provider truth. The separate source provider reference remains stable while the refund's own provider reference transitions from internal claim to real `re_` evidence.

`reconcileStripeRefundTransaction` handles a pending refund that already has a real `re_` reference. It retrieves the refund without replaying the write and verifies refund ID, source PaymentIntent, currency, and exact minor-unit amount before accepting provider status. `succeeded` becomes `SUCCEEDED`; `failed`/`canceled` become `FAILED`; non-final states remain `PENDING`. Successful reconciliation recalculates cumulative successful refunds under the booking lock and cannot regress a fully refunded booking.

See `docs/stripe-refunds.md` for the detailed refund lifecycle and webhook finalization rules.

## Stripe webhook ingestion

`POST /api/webhooks/stripe/[organization-id]` is the external Stripe callback boundary. It is deliberately not session-authenticated or same-origin protected because Stripe is the caller; authenticity is established by the tenant-specific encrypted webhook secret and the Stripe signature over the **original raw request body**.

Webhook processing follows a fail-closed, tenant-safe sequence:

- the route reads `request.text()` exactly once and passes the untouched string plus `Stripe-Signature` to the payment adapter before JSON parsing;
- the tenant Stripe integration must be active, advertise the `webhooks` capability, contain a valid webhook secret, and expose the provider `WEBHOOKS` capability;
- request size and signature-header bounds are enforced before persistence;
- only after signature verification does SF parse and normalize supported PaymentIntent, Checkout Session, or refund event objects;
- `PaymentWebhookEvent` stores the tenant/provider event ID, event type, SHA-256 payload hash, safe provider/booking references, processing status/note, and timestamps — never the raw webhook body, API secret, webhook secret, or card data;
- `(organizationId, providerCode, providerEventId)` is unique and an advisory event lock makes exact redelivery idempotent; reusing an event ID with different signed content is rejected as a conflict.

PaymentIntent callbacks must carry the SF organization/booking metadata created during authorization. That metadata must match the tenant endpoint, a confirmed tenant-owned booking, currency, and immutable booking total. Only a persisted pending authorization/capture operation can be resolved; exact provider references are preferred, while an unambiguous internal claim can acquire its real PaymentIntent reference.

Checkout Session callbacks must resolve the exact tenant-owned persisted `PaymentCheckoutSession`, booking, and capture claim and revalidate signed metadata plus immutable booking money. A complete/paid Session can bind the real PaymentIntent, mark the capture successful, and mark the booking paid. A signed Session expiry cancels/releases an unpaid booking only when the tracked Session/payment state and absence of successful or late-payment evidence all agree; otherwise SF preserves the booking for recovery.

Refund callbacks derive booking ownership from the tenant-owned successful capture referenced by the signed refund object's `payment_intent`; they do not rely on browser redirects or refund metadata. SF revalidates the source capture, confirmed booking, immutable booking money, refund money, and provider-reference ownership under the booking lock. An exact pending refund reference is preferred. A single money-matching internal refund claim can acquire the real `re_` reference; ambiguous claims fail closed. Refund state mapping is shared with provider-truth reconciliation, and successful callbacks recalculate partial/full refund state without allowing booking payment-state regression. New refund claims retain their persisted source settlement reference throughout this lifecycle.

Unsupported event types, missing/mismatched payment metadata, unavailable resources, money mismatches, or callbacks with no matching pending operation are recorded as `IGNORED` and do not mutate payment state.

The persisted webhook ledger provides duplicate suppression and callback evidence without introducing a separate event service. The current modular-monolith implementation processes the small normalized transition synchronously; a separate queue is not introduced without a demonstrated operational need.

## API boundary

- `POST /api/payments/manual` records a confirmed offline payment.
- `POST /api/payments/manual/refunds` records a confirmed offline refund.
- `POST /api/payments/stripe/refunds` creates a server-authorized Stripe refund operation.
- `POST /api/payments/stripe/reconcile` reconciles one tenant-owned pending Stripe authorization/capture transaction from provider truth.
- `POST /api/payments/stripe/refunds/reconcile` reconciles one tenant-owned pending Stripe refund from provider truth.
- `POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout` creates or safely resumes the capability-owned hosted Checkout operation for a public booking.
- `POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout/status` returns customer-safe authoritative payment/recovery state without putting the bearer capability in a URL.
- `POST /api/webhooks/stripe/[organization-id]` verifies and ingests tenant-specific Stripe PaymentIntent, Checkout Session, and refund callbacks from the raw request body.
- `GET /api/payments/transactions?bookingId=...` returns paginated tenant-scoped history.

BigInt money is serialized as decimal strings. Internal Stripe provider-call claim references are serialized as `null`, never as if they were real Stripe identifiers.

## Permissions

Organization `ADMIN` and `MANAGER` roles receive `payment:read` and `payment:manage`. `STAFF` receives `payment:read`. `CUSTOMER` receives no internal ledger capability. Public booking payment uses a separate encrypted capability plus persisted public-principal/booking ownership and never weakens staff/admin permissions.

The Stripe webhook route does not reuse interactive permissions: it has no user actor and can operate only after tenant-specific provider signature verification plus tenant-owned booking/payment/refund resolution.

## Validation and remaining work

The normal unit test glob includes payment-provider, Stripe-adapter, Stripe-persistence, HTTP serialization, payment/refund reconciliation, public payment-recovery, Stripe webhook-domain, settlement-reconciliation, and refund-availability coverage. Settlement coverage now verifies explicit refund-to-source attribution, per-source remaining balances, safe single-source legacy inference, legacy multi-source fail-closed behavior, unknown source references, source-level over-refunds, same-provider multi-source aggregation, authorization/capture de-duplication, mixed providers, unresolved operations, internal claims, cross-currency rows, and duplicate provider references. Refund availability additionally verifies that the user-facing general refund action remains fail-closed for multiple sources until a deterministic allocation policy exists.

The guarded disposable PostgreSQL suite includes `stripe-payment.integration.ts`, `stripe-refund.integration.ts`, and `stripe-refund-webhook.integration.ts`, plus the public booking confirmation/payment persistence coverage. Checked-in coverage spans encrypted tenant Stripe configuration, permission/cross-tenant denial before provider calls, persisted pre-provider claims, simultaneous different-idempotency suppression, exact/changed retries, successful authorization/capture/refund, ambiguous-provider retry/recovery, provider-reference ownership, provider-truth reconciliation, verified internal-claim webhook resolution for payments and refunds, Checkout Session persistence/lifecycle handling, duplicate callback idempotency, altered duplicate rejection, callback tenant/money handling, refund balance enforcement, public ownership, and audit secret/reference minimization.

That database suite must still be **executed** against an explicitly confirmed disposable PostgreSQL target before Stripe persistence, source-attribution migration, locking, or webhook-concurrency validation is claimed as passed. `npm run test:database` remains the required gate because it runs Prisma validation, migration deployment/status/drift checks, and the integration suites together.

Still open: deterministic multi-source refund allocation/execution, commercial-amendment provider execution/final apply, receipts/invoices, PayPal when prioritized, broader production webhook operational validation, and live PostgreSQL validation. Customer-facing Stripe collection is implemented through the real capability-owned hosted Checkout path; do not regress to a fake redirect or browser-success model. Do not claim database validation passed unless `npm run test:database` runs against the explicitly confirmed disposable PostgreSQL target.
