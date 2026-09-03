# Payments

SF keeps booking state and payment state separate. Provider-specific behavior stays behind normalized payment adapters; application services own tenant scope, authorization, idempotency, persistence, booking-state transitions, audit history, and recovery.

## Provider contract and adapters

`src/server/payments/payment-provider.ts` defines explicit capabilities for offline recording/refunds, authorization, capture, authorization release, refunds, and webhooks. Money is exact integer minor units plus a three-letter currency. Online flows accept only provider-issued references; SF never accepts raw card data.

The manual provider records real money movements that already happened outside SF. Stripe is the first real online adapter. Tenant credentials are loaded only through the encrypted integration boundary. Stripe-specific Checkout, authorization/capture, refunds, polling reconciliation, and webhook verification remain behind Stripe adapter/services.

Public hospitality payment and customer-authorized commercial-amendment collection use Stripe-hosted Checkout. Browser redirects never establish payment truth; persisted provider references plus polling/signed provider callbacks do.

## Persisted payment ledger

`PaymentTransaction` is tenant scoped and booking owned. It stores operation kind/status, provider code/reference, exact money, request fingerprint, tenant-unique idempotency identity, nullable `sourceProviderReference` for refund attribution, and nullable `commercialAmendmentId` for adjustment-owned money.

When `commercialAmendmentId` is present, the database requires amendment, booking, and organization identity to match the same commercial-amendment tuple. Generic booking payments/refunds do not populate it. Dedicated manual/Stripe amendment executors populate it only for adjustment money.

Payment writes serialize relevant tenant idempotency, booking/mutation, and provider-reference scopes with PostgreSQL advisory locks and serializable transactions where required. Public booking Checkout additionally persists `PaymentCheckoutSession`; commercial-amendment Checkout instead binds the exact Stripe Session directly to the amendment-attributed `PaymentTransaction`, preserving amendment ownership without inventing a public principal.

## Authoritative booking settlement

`deriveBookingSettlementSummary` is the shared provider-neutral view of authoritative booking money. Successful `OFFLINE_PAYMENT`, `CAPTURE`, and settled `AUTHORIZATION` rows form gross settlement; matching capture/authorization evidence is de-duplicated.

Successful refunds reduce the exact settlement source identified by `sourceProviderReference`. Each source exposes gross, refunded, and remaining money. Legacy unattributed refunds are accepted only when a provider has exactly one effective settlement source; ambiguous multi-source history fails closed.

Settlement also fails closed for unresolved `PENDING`/`AMBIGUOUS` operations, cross-currency success, missing provider identity, successful internal `sf_claim_*` markers, duplicate provider references, unknown refund sources, or over-refunds.

Commercial amendment preparation requires reconciled net settlement equal to the current booking total through exactly one supported provider (`manual` or `stripe`). Multiple sources from that one provider remain valid when refund attribution is unambiguous.

## Commercial amendment settlement

`deriveHospitalityCommercialAmendmentSettlementState` isolates payment rows linked to one persisted amendment and proves whether the prepared delta requires execution, has unresolved provider work, is fully settled, or conflicts with ledger truth. Additional-charge settlement counts received money, not an authorization alone. Refund settlement is source-attributed and can progress across multiple sources.

`deriveHospitalityCommercialAmendmentExecutionDecision` adds lifecycle authority and returns only `EXECUTE`, `WAIT_FOR_PROVIDER`, `READY_TO_APPLY`, `RECOVERY_REQUIRED`, `EXPIRED`, `TERMINAL`, or `CONFLICT`. Expired amendments cannot initiate normal adjustment money movement. Existing unresolved/successful amendment payment evidence after expiry becomes recovery work rather than silently disappearing.

The authenticated product transport maps those decisions to manual settlement, source-scoped Stripe refund, customer-authorized Stripe Checkout, provider wait, ready-to-apply, and recovery/terminal states. Every financial operation is re-derived server-side; the browser cannot choose amount, currency, provider, refund source, settlement truth, or apply authority.

## Manual amendment settlement

`recordManualHospitalityBookingCommercialAmendmentSettlement` requires both `booking:manage` and `payment:manage`, tenant-scopes booking/amendment reads, serializes the booking/idempotency boundary, and re-derives the exact next operation from the complete ledger.

For an additional charge, staff first receive the exact amount outside SF and record the real external payment reference. For refunds, SF chooses the exact source/amount and staff record the real external refund reference only after that refund actually succeeds externally. Large refunds can progress source by source. Booking commercial/payment state is unchanged until final amendment apply.

## Stripe commercial amendment settlement

Stripe amendment refunds use dedicated source-aware execution, exact retry/polling reconciliation, and signed callback finalization. The browser never chooses the PaymentIntent source or refund amount.

Stripe additional charges have two amendment-owned paths:

- an internal authorization/capture executor for trusted server-owned PaymentMethod workflows; and
- a customer-authorized Stripe-hosted Checkout flow from the booking workspace for normal price increases.

The hosted Checkout flow derives the exact remaining adjustment under tenant booking/payment locks, creates one amendment-attributed `CAPTURE / AMBIGUOUS` claim, and uses tenant-bound deterministic idempotency/fingerprint identity. Stripe receives explicit organization, booking, amendment, and purpose metadata on both Session and PaymentIntent.

`POST .../[amendment-id]/stripe-checkout/status` polls the exact bound Session. Signed `checkout.session.completed` / `checkout.session.expired` events pass through tenant-specific signature verification and a dedicated normal-amendment Checkout finalizer before generic booking finalization. Both paths validate exact Session, tenant, booking, amendment, purpose, currency, amount, and PaymentIntent identity before updating only amendment payment evidence.

A Stripe Checkout Session can outlive the prepared amendment/inventory-protection window. If payment becomes authoritative after amendment expiry, SF records the real money but does not apply stale booking terms. Existing expired-amendment recovery then derives compensation—normally a source-scoped refund of adjustment-created money—before the amendment can close.

Internal `sf_claim_*` references are never treated as provider truth. Provider ambiguity remains exact-retry/polling/webhook recovery work, not permission to start another charge.

Detailed additional-charge semantics are in `docs/stripe-commercial-amendment-charges.md`; refund behavior is in `docs/stripe-refunds.md`; signed amendment callback behavior is in `docs/stripe-commercial-amendment-webhooks.md`.

## Deterministic refund planning

`deriveNextBookingRefundSource` chooses a provider-neutral source only from reconciled source balances. It ignores exhausted sources, validates provider/currency/balances/identity, rejects duplicates, chooses the source with the largest refundable balance, and uses stable lexical tie-breaking.

`deriveBookingRefundExecutionPlan` composes that allocation with whole-booking settlement and payment-state reconciliation. One operation returns exact provider, settlement source, source balance, operation amount, total refundable balance, source count, and resulting booking payment status. An explicit amount cannot silently span multiple settlement sources.

Manual and Stripe generic refund execution consume this same contract under tenant booking/mutation/idempotency locks. Refund availability reasons from net settled money: `PAID` means net settlement equals the current booking total; `PARTIALLY_REFUNDED` means a positive net balance below it; zero is `REFUNDED`.

## Final amendment apply and recovery

Only `applyHospitalityBookingCommercialAmendment` can rewrite booking commercial terms, allocation, immutable price components, and denormalized payment status. Under serializable booking/inventory locks it revalidates booking version, current/target terms, target hold, target inventory, restrictions, current transactional pricing, adjustment identity, and the complete amendment ledger.

Provider success alone is insufficient. An unexpired amendment with exact settlement can become `READY_TO_APPLY`; an expired amendment or an amendment that can no longer satisfy final booking/inventory checks belongs to recovery/compensation instead of forcing stale terms into the booking.

Expired-amendment recovery handles unresolved provider operations, Stripe authorization release/capture recovery, compensating source-scoped refunds, manual compensation, and customer-authorized Stripe recovery Checkout when a prior refund left settlement below the original booking total.

## Stripe webhook ingestion

`POST /api/webhooks/stripe/[organization-id]` is the external callback boundary. It is intentionally not user-session authenticated; authenticity comes from the tenant-specific encrypted Stripe webhook secret and verification over the raw request body.

Verified events are durably ingested with provider event identity and payload hash. Dedicated commercial-amendment Checkout/recovery finalizers run before generic amendment/booking finalizers so adjustment-owned evidence cannot mutate normal booking payment state. Every finalizer revalidates tenant ownership, persisted provider reference, exact money, and operation identity; unsupported or untracked events are never guessed into payment success.

## API and authorization boundaries

- `POST /api/payments/manual` records a confirmed offline payment.
- `POST /api/payments/manual/refunds` records a confirmed source-aware offline refund.
- `POST /api/payments/stripe/refunds` executes a server-authorized source-aware Stripe refund.
- `POST /api/payments/stripe/reconcile` reconciles one tenant-owned Stripe authorization/capture transaction.
- `POST /api/payments/stripe/refunds/reconcile` reconciles one tenant-owned Stripe refund.
- `POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout` creates/resumes capability-owned public Checkout.
- `POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout/status` returns customer-safe public payment/recovery state.
- `POST /api/webhooks/stripe/[organization-id]` verifies and ingests tenant Stripe callbacks.
- `GET /api/payments/transactions?bookingId=...` returns paginated tenant-scoped history.
- `GET|POST /api/bookings/hospitality/[booking-id]/commercial-amendments` discovers/prepares reviewed non-zero amendments.
- `GET .../commercial-amendments/[amendment-id]` returns authoritative amendment orchestration state.
- `POST .../[amendment-id]/manual-settlement` records completed external manual adjustment evidence.
- `POST .../[amendment-id]/stripe-refund` executes the next server-selected amendment refund source.
- `POST .../[amendment-id]/stripe-refund/status` performs exact Stripe amendment-refund retry/reconciliation.
- `POST .../[amendment-id]/stripe-checkout` creates/resumes customer-authorized normal Stripe amendment Checkout.
- `POST .../[amendment-id]/stripe-checkout/status` reconciles the exact normal amendment Checkout Session.
- `POST .../[amendment-id]/apply` invokes final serializable apply after settlement proves readiness.
- `POST .../[amendment-id]/cancel` invokes guarded cancellation before adjustment money/recovery evidence makes cancellation unsafe.

Organization `ADMIN` and `MANAGER` roles receive `payment:read`/`payment:manage`; `STAFF` receives `payment:read`; `CUSTOMER` receives no internal ledger capability. Public booking payment uses a separate encrypted capability and persisted booking/principal ownership. Commercial-amendment settlement requires both booking/payment management authority. Webhooks have no user actor and may mutate only after tenant-specific provider verification and tenant-owned resource resolution.

BigInt money is serialized as decimal strings. Internal claim references are not presented as real provider identifiers.

## Validation and remaining work

Dependency-free coverage includes settlement reconciliation, refund-source attribution/allocation, whole-booking payment-state reconciliation, provider normalization, public payment recovery, commercial-amendment settlement/execution/recovery decisions, manual/Stripe amendment flows, normal commercial Checkout identity/reconciliation/webhook parsing, Stripe amendment refund/charge recovery, signed callback candidate isolation, and final-apply consistency.

The guarded disposable PostgreSQL suite remains the required gate for Prisma schema/migrations, tenant isolation, locking, idempotency, provider persistence, webhook concurrency, amendment-payment foreign keys, provider executors, signed callback finalization, product transport routes, and final apply. Full typecheck/lint/test/build and Prisma validation must run in the repository-required Node 24 environment. Do not claim those checks passed without that environment and an explicitly disposable PostgreSQL target.

Still open in the broader payments roadmap are invoices/tax documents and production provider operational validation. Do not regress to fake redirects, browser-success payment truth, browser-selected settlement sources, browser-selected financial identity, or browser-authorized amendment apply. GitHub Actions are not used for validation.
