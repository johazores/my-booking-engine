# Payments

SF keeps booking state and payment state separate. Provider-specific behavior stays behind normalized payment adapters; application services own tenant scope, authorization, idempotency, persistence, booking-state transitions, audit history, and recovery.

## Provider contract and adapters

`src/server/payments/payment-provider.ts` defines explicit capabilities for offline recording, offline refunds, authorization, capture, refunds, and webhooks. Money is always represented as exact integer minor units with an explicit three-letter currency. Online authorization accepts only provider-issued payment-method references; SF never accepts raw card data through this server contract.

The manual provider records real payments and refunds that already happened outside SF. It never pretends to move funds. Stripe is the first real online adapter. Tenant credentials are loaded only through the encrypted integration boundary. Authorization, capture, refunds, hosted Checkout, webhook verification, PaymentIntent reconciliation, and refund reconciliation remain provider-specific adapter concerns.

Public hospitality collection uses Stripe-hosted Checkout. SF sends only authoritative tenant-owned booking money, tenant/booking metadata, server-derived return URLs, and an optional customer email. Browser redirects do not establish payment truth; persisted Checkout state, signed provider callbacks, and capability-owned recovery do.

## Persisted payment ledger

`PaymentTransaction` is tenant scoped and linked to the tenant-owned booking. It stores operation kind/status, provider code/reference, exact money, request fingerprint where applicable, tenant-unique idempotency identity, and nullable `sourceProviderReference` for refund-to-settlement-source attribution.

New manual refunds persist the exact offline payment reference they reduce. New Stripe refund claims persist the exact successful PaymentIntent/capture reference before the provider call. Historical refunds remain nullable so SF does not invent an unsafe backfill.

Payment writes serialize the relevant tenant idempotency, booking, mutation, and provider-reference scopes with PostgreSQL advisory locks and serializable transactions where required. Public hosted Checkout additionally persists `PaymentCheckoutSession`, which binds tenant, public principal, booking, payment claim, provider Session reference, lifecycle status, and provider expiry.

## Authoritative booking settlement

`deriveBookingSettlementSummary` is the shared pure-domain view of authoritative booking money. Successful `OFFLINE_PAYMENT`, `CAPTURE`, and settled `AUTHORIZATION` rows form gross settlement. A successful capture replaces the matching authorization in the calculation so the same provider settlement is not counted twice.

Successful refunds reduce the exact effective settlement source identified by `sourceProviderReference`. Each source exposes gross, refunded, and remaining minor-unit amounts; provider and booking totals are derived from those source balances. A legacy unattributed refund is accepted only when its provider has exactly one effective settlement source. Legacy multi-source history without attribution fails closed rather than guessing.

Settlement reconciliation also fails closed for unresolved `PENDING`/`AMBIGUOUS` operations, cross-currency success, missing provider identity, successful internal `sf_claim_*` markers, duplicate provider references, unknown refund sources, or source-level over-refunds.

Commercial amendment preparation uses authoritative **net settled money** and currently requires it to equal the authoritative booking total through exactly one supported provider (`manual` or `stripe`). Multiple sources from that same provider are valid settlement history when refund attribution is unambiguous.

## Deterministic refund execution planning

`deriveNextBookingRefundSource` defines provider-neutral source allocation from reconciled source balances. It never trusts browser-supplied source authority. The allocator ignores fully refunded sources, requires one provider and one currency across refundable sources, validates every source balance, rejects duplicate provider/source identity, chooses the source with the largest remaining refundable balance, and uses stable provider/reference lexical tie-breakers so database/input ordering cannot change the decision.

`deriveBookingRefundExecutionPlan` composes that allocation with authoritative booking settlement and whole-booking payment-state reconciliation. For one refund operation it returns the exact provider, settlement source, source balance, operation amount, total booking refundable balance, refundable-source count, and resulting whole-booking payment status. Omitting an amount means refund the selected source's remaining balance; an explicit amount cannot silently span multiple settlement sources.

Manual refund execution now consumes this contract end to end. Under the existing tenant booking/mutation/idempotency locks, SF re-reads the full tenant-owned payment ledger, selects the authoritative manual source server-side, records the external refund against that exact source, and derives the booking's next payment status from whole-booking net settlement. Multiple manual settlement sources are therefore supported sequentially without treating one exhausted source as a fully refunded booking.

The booking-detail refund UI shows both the total remaining refundable balance and the amount of the next source-scoped operation. For manual payments it also shows the exact external payment source that staff must refund outside SF before entering the real external refund reference. The browser does not choose the source.

Multiple Stripe settlement sources remain intentionally unavailable through the general refund action until the Stripe write, retry, reconciliation, and webhook paths all consume the same source-aware execution contract. Single-source Stripe refunds continue to use the existing real provider workflow.

Refund availability reconciles booking payment state against **net** settled money rather than gross settlement. `PAID` requires net settlement to equal the current authoritative booking total. `PARTIALLY_REFUNDED` requires a strictly positive net balance below that total. This supports price-adjustment histories where historical gross settlement can exceed the current booking total after an attributed compensating refund.

## Stripe write and recovery boundaries

Stripe authorization/capture/refund writes require `payment:manage`, tenant-owned booking access, immutable booking money, configured tenant integration capabilities, provider capability checks, and persisted idempotency/fingerprint evidence. Provider calls are claimed in the ledger before the external request where ambiguity must be recoverable. Retryable transport/timeout failures preserve unresolved state; definitive failures do not claim success.

`reconcileStripePaymentTransaction` resolves persisted pending authorization/capture rows from provider truth without replaying writes. `reconcileStripeRefundTransaction` does the same for pending refunds that already have a real provider refund reference. Internal claim references are never presented as provider truth.

Detailed refund semantics and callback rules remain documented in `docs/stripe-refunds.md`.

## Stripe webhook ingestion

`POST /api/webhooks/stripe/[organization-id]` is the external Stripe callback boundary. It is not session-authenticated or same-origin protected because Stripe is the caller; authenticity comes from the tenant-specific encrypted webhook secret and signature over the original raw body.

Webhook processing verifies request bounds/signature before parsing, persists tenant/provider event identity plus a payload hash for idempotency, and resolves only tenant-owned persisted payment/Checkout/refund operations. PaymentIntent metadata, Checkout persistence, booking ownership, exact money, and provider-reference ownership are revalidated before mutation. Unsupported, mismatched, ambiguous, or untracked events are recorded as ignored rather than guessed.

## API and authorization boundaries

- `POST /api/payments/manual` records a confirmed offline payment.
- `POST /api/payments/manual/refunds` records a confirmed offline refund, including source-aware sequential refunds across multiple manual settlements.
- `POST /api/payments/stripe/refunds` creates a server-authorized Stripe refund operation.
- `POST /api/payments/stripe/reconcile` reconciles one tenant-owned pending Stripe authorization/capture transaction.
- `POST /api/payments/stripe/refunds/reconcile` reconciles one tenant-owned pending Stripe refund.
- `POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout` creates or resumes the capability-owned hosted Checkout operation.
- `POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout/status` returns customer-safe authoritative payment/recovery state.
- `POST /api/webhooks/stripe/[organization-id]` verifies and ingests tenant-specific Stripe callbacks.
- `GET /api/payments/transactions?bookingId=...` returns paginated tenant-scoped history.

BigInt money is serialized as decimal strings. Internal provider-call claim references are serialized as `null` rather than exposed as real provider identifiers.

Organization `ADMIN` and `MANAGER` roles receive `payment:read` and `payment:manage`; `STAFF` receives `payment:read`; `CUSTOMER` receives no internal ledger capability. Public booking payment uses a separate encrypted capability and persisted booking/principal ownership. Webhooks have no user actor and may mutate state only after tenant-specific provider verification and tenant-owned resource resolution.

## Validation and remaining work

Dependency-free payment-domain coverage includes settlement reconciliation, refund-source attribution, deterministic refund allocation/execution planning, refund availability, provider normalization, Stripe request/recovery domains, public payment recovery, and webhook-domain behavior. Allocation/planning coverage verifies input-order independence, largest-balance selection, stable tie-breaking, fully-refunded-source exclusion, source-by-source manual progression, explicit cross-source rejection, mixed-provider failure, malformed/duplicate source rejection, payment-state drift rejection, and exact bigint totals.

The guarded disposable PostgreSQL suite remains the required validation gate for Prisma schema/migrations, locking, idempotency, provider persistence, webhook concurrency, and source-attribution behavior. Do not claim that gate passed unless `npm run test:database` runs against an explicitly confirmed disposable PostgreSQL target.

Still open in this dependency cluster: source-aware multi-source Stripe refund execution/recovery, commercial-amendment provider execution/final apply, invoices/tax documents, and broader production provider operational validation. Customer-facing Stripe Checkout is real and implemented; do not regress to a fake redirect or browser-success model.
