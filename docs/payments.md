# Payments

SF keeps booking state and payment state separate. Provider-specific behavior stays behind normalized payment adapters; application services own tenant scope, authorization, idempotency, persistence, booking-state transitions, audit history, and recovery.

## Provider contract and adapters

`src/server/payments/payment-provider.ts` defines explicit capabilities for offline recording, offline refunds, authorization, capture, refunds, and webhooks. Money is always represented as exact integer minor units with an explicit three-letter currency. Online authorization accepts only provider-issued payment-method references; SF never accepts raw card data through this server contract.

The manual provider records real payments and refunds that already happened outside SF. It never pretends to move funds. Stripe is the first real online adapter. Tenant credentials are loaded only through the encrypted integration boundary. Authorization, capture, refunds, hosted Checkout, webhook verification, PaymentIntent reconciliation, and refund reconciliation remain provider-specific adapter concerns.

Public hospitality collection uses Stripe-hosted Checkout. SF sends only authoritative tenant-owned booking money, tenant/booking metadata, server-derived return URLs, and an optional customer email. Browser redirects do not establish payment truth; persisted Checkout state, signed provider callbacks, and capability-owned recovery do.

## Persisted payment ledger

`PaymentTransaction` is tenant scoped and linked to the tenant-owned booking. It stores operation kind/status, provider code/reference, exact money, request fingerprint where applicable, tenant-unique idempotency identity, nullable `sourceProviderReference` for refund-to-settlement-source attribution, and nullable `commercialAmendmentId` for an operation explicitly owned by a commercial amendment.

New manual refunds persist the exact offline payment reference they reduce. New Stripe refund claims persist the exact successful PaymentIntent/capture reference before the provider call. Historical refunds remain nullable so SF does not invent an unsafe backfill.

When `commercialAmendmentId` is present, the database requires the payment row's amendment ID, booking ID, and organization ID to match the same commercial amendment tuple. Existing general payment/refund actions do not populate this field. The internal manual amendment executor and dedicated Stripe amendment refund/charge executors populate it only for adjustment money explicitly owned by a prepared amendment; generic booking-payment writes remain separate.

Payment writes serialize the relevant tenant idempotency, booking, mutation, and provider-reference scopes with PostgreSQL advisory locks and serializable transactions where required. Public hosted Checkout additionally persists `PaymentCheckoutSession`, which binds tenant, public principal, booking, payment claim, provider Session reference, lifecycle status, and provider expiry.

## Authoritative booking settlement

`deriveBookingSettlementSummary` is the shared pure-domain view of authoritative booking money. Successful `OFFLINE_PAYMENT`, `CAPTURE`, and settled `AUTHORIZATION` rows form gross settlement. A successful capture replaces the matching authorization in the calculation so the same provider settlement is not counted twice.

Successful refunds reduce the exact effective settlement source identified by `sourceProviderReference`. Each source exposes gross, refunded, and remaining minor-unit amounts; provider and booking totals are derived from those source balances. A legacy unattributed refund is accepted only when its provider has exactly one effective settlement source. Legacy multi-source history without attribution fails closed rather than guessing.

Settlement reconciliation also fails closed for unresolved `PENDING`/`AMBIGUOUS` operations, cross-currency success, missing provider identity, successful internal `sf_claim_*` markers, duplicate provider references, unknown refund sources, or source-level over-refunds.

Commercial amendment preparation uses authoritative **net settled money** and currently requires it to equal the authoritative booking total through exactly one supported provider (`manual` or `stripe`). Multiple sources from that same provider are valid settlement history when refund attribution is unambiguous.

## Commercial amendment settlement reconciliation

`deriveHospitalityCommercialAmendmentSettlementState` isolates payment rows linked to one persisted commercial amendment and proves whether the immutable delta still requires execution, has unresolved provider work, is fully settled and ready for final apply, or conflicts with authoritative ledger truth. Additional-charge settlement counts successful offline/capture money, not authorization alone. Refund settlement requires source attribution and can progress source by source across multiple refundable settlements.

The reconciliation fails closed when linked rows cross provider/currency, use the wrong operation direction, exceed the required adjustment, leave more than one amendment operation unresolved, or when booking-level net settlement changes outside amendment-linked evidence. This keeps provider execution behind adapters while preserving a provider-neutral proof that the exact before/after booking money relationship is true.

`deriveHospitalityCommercialAmendmentExecutionDecision` adds lifecycle authority to that settlement proof. It produces only `EXECUTE`, `WAIT_FOR_PROVIDER`, `READY_TO_APPLY`, `RECOVERY_REQUIRED`, `EXPIRED`, `TERMINAL`, or `CONFLICT`. For refunds, the execution amount is bounded to the server-selected settlement source; browser input never supplies the source or amount. Expired amendments cannot initiate new adjustment operations, while expired amendments with existing settlement/provider activity become recovery-required instead of silently moving more money.

The internal settlement-status service requires both `booking:manage` and `payment:manage`, scopes amendment and ledger reads by organization and booking, and reads them in one serializable snapshot. Lifecycle remains authoritative: a reconciled payment delta does not make an expired or terminal amendment applicable.

`applyHospitalityBookingCommercialAmendment` is the internal final consumer of `READY_TO_APPLY`. Under the tenant booking mutation lock and current/target inventory locks it revalidates booking version, current and target commercial snapshots, target hold identity/expiry, authoritative transactional pricing, and the complete amendment-attributed ledger before any booking mutation. It then atomically replaces booking/allocation commercial state, restores booking payment status to `PAID` because net settlement equals the amended total, releases target protection, marks the amendment `APPLIED`, and records audit history.

## Manual amendment settlement

`recordManualHospitalityBookingCommercialAmendmentSettlement` remains the amendment-owned provider executor for manual settlement. The booking workspace can now reach it only through the authenticated commercial-amendment transport after a non-zero reviewed change has been prepared. The product boundary requires both `booking:manage` and `payment:manage`, and the browser supplies only the real external reference plus an idempotent operation identity; amount, direction, provider, amendment ownership, and refund source are re-derived server-side.

The executor tenant-scopes booking and amendment reads, serializes tenant idempotency plus the shared booking mutation lock, verifies the booking is still the same confirmed/paid snapshot that was prepared, re-derives the complete amendment settlement state, and decides the exact next operation server-side.

For an additional charge it records exactly the remaining amendment delta against a real external manual payment reference. For a refund it re-derives authoritative settlement balances, deterministically selects the source, limits one operation to that source's refundable balance, and records the real external refund reference with `sourceProviderReference` plus `commercialAmendmentId`. Request fingerprints bind amendment, operation, money, source, and reference; tenant duplicate references and mismatched idempotent retries fail closed.

The manual adapter still does not move funds. Staff must have completed the external charge/refund before SF records it. The executor intentionally does **not** update `HospitalityBooking.paymentStatus`, commercial fields, allocation, or `updatedAt`; only payment/audit evidence changes before final apply. This preserves the prepared `bookingVersion` stale-write guard.

Stripe amendment settlement is also isolated from generic booking-payment writes. The booking workspace now exposes the real source-scoped Stripe refund path, exact retry/reconciliation state, and final apply when settlement is ready. Stripe price increases remain explicitly closed in the product transport until a fresh customer-authorized collection boundary exists; the internal authorization/capture service is not treated as browser authority.

## Deterministic refund execution planning

`deriveNextBookingRefundSource` defines provider-neutral source allocation from reconciled source balances. It never trusts browser-supplied source authority. The allocator ignores fully refunded sources, requires one provider and one currency across refundable sources, validates every source balance, rejects duplicate provider/source identity, chooses the source with the largest remaining refundable balance, and uses stable provider/reference lexical tie-breakers so database/input ordering cannot change the decision.

`deriveBookingRefundExecutionPlan` composes that allocation with authoritative booking settlement and whole-booking payment-state reconciliation. For one refund operation it returns the exact provider, settlement source, source balance, operation amount, total booking refundable balance, refundable-source count, and resulting whole-booking payment status. Omitting an amount means refund the selected source's remaining balance; an explicit amount cannot silently span multiple settlement sources.

Manual and Stripe generic refund execution consume this contract end to end. Under tenant booking/mutation/idempotency locks, SF re-reads the full tenant-owned payment ledger, selects the authoritative source server-side, binds the refund to that exact source, and derives the booking's next payment status from whole-booking net settlement. Multiple settlement sources from one supported provider can therefore be refunded sequentially without treating one exhausted source as a fully refunded booking.

The booking-detail refund UI shows both the total remaining refundable balance and the amount of the next source-scoped operation. For manual payments it also shows the exact external payment source that staff must refund outside SF before entering the real external refund reference. Stripe source authority remains server-side; the browser does not choose or override the PaymentIntent source.

Refund availability reconciles booking payment state against **net** settled money rather than gross settlement. `PAID` requires net settlement to equal the current authoritative booking total. `PARTIALLY_REFUNDED` requires a strictly positive net balance below that total. This supports price-adjustment histories where historical gross settlement can exceed the current booking total after an attributed compensating refund.

## Stripe write and recovery boundaries

Stripe authorization/capture/refund writes require `payment:manage`, tenant-owned booking access, immutable booking money, configured tenant integration capabilities, provider capability checks, and persisted idempotency/fingerprint evidence. Provider calls are claimed in the ledger before the external request where ambiguity must be recoverable. Retryable transport/timeout failures preserve unresolved state; definitive failures do not claim success.

Stripe generic refund writes, exact retries, read-only polling reconciliation, and signed refund webhook finalization all use the persisted `sourceProviderReference` plus the same deterministic execution plan. Each provider request refunds one selected source at a time. Before a retry or finalization can change money state, SF re-derives the authoritative ledger allocation and fails closed if source, amount, currency, booking state, or settlement history drifted.

`reconcileStripePaymentTransaction` resolves persisted pending authorization/capture rows from provider truth without replaying writes. `reconcileStripeRefundTransaction` does the same for pending refunds that already have a real provider refund reference. Internal claim references are never presented as provider truth. A legacy pending Stripe refund without persisted source attribution cannot be safely recovered automatically and fails closed for operator reconciliation rather than guessing.

Generic Stripe boundaries continue to update booking payment state only for normal booking payments/refunds. Amendment-linked Stripe transactions use dedicated services and `AMBIGUOUS` claims so generic `PENDING` finalizers cannot mutate `HospitalityBooking.paymentStatus` before final apply. `refundStripeHospitalityBookingCommercialAmendment` plus its reconciliation service own refund evidence; `chargeStripeHospitalityBookingCommercialAmendment` plus `reconcileStripeHospitalityBookingCommercialAmendmentCharge` own additional-charge authorization/capture evidence. Detailed additional-charge semantics are in `docs/stripe-commercial-amendment-charges.md`.

Detailed refund semantics and callback rules remain documented in `docs/stripe-refunds.md`.

## Stripe webhook ingestion

`POST /api/webhooks/stripe/[organization-id]` is the external Stripe callback boundary. It is not session-authenticated or same-origin protected because Stripe is the caller; authenticity comes from the tenant-specific encrypted webhook secret and signature over the original raw body.

Webhook processing verifies request bounds/signature before parsing, persists tenant/provider event identity plus a payload hash for idempotency, and resolves only tenant-owned persisted payment/Checkout/refund operations. PaymentIntent metadata, Checkout persistence, booking ownership, exact money, and provider-reference ownership are revalidated before mutation. Refund callbacks additionally bind the Stripe refund object's `payment_intent` to the persisted refund `sourceProviderReference` and re-derive the whole-booking refund plan before accepting final state. Unsupported, mismatched, ambiguous, or untracked events are recorded as ignored rather than guessed.

After the standard signed webhook ingestion succeeds, `finalizeVerifiedStripeCommercialAmendmentWebhook` can promote an ignored event when it exactly matches amendment-owned `AMBIGUOUS` evidence that already contains the real Stripe provider reference. PaymentIntent callbacks require exact tenant/booking metadata, PaymentIntent identity, currency, amount, and received/capturable provider money. Refund callbacks require the exact persisted refund reference, source PaymentIntent, currency, amount, amendment ownership, and refund fingerprint. These callbacks change only amendment payment evidence and the verified event ledger; they never change booking payment/commercial state before final apply.

The amendment callback boundary intentionally does not guess provider ownership for an internal `sf_claim_*` row. Signed provider data proves event authenticity, but a provider reference not yet persisted locally is insufficient to choose among potential same-booking amendment claims safely. Exact executor retry and dedicated polling remain the recovery authority for pre-reference uncertainty; expired cases require operator compensation/recovery. Full details are in `docs/stripe-commercial-amendment-webhooks.md`.

## API and authorization boundaries

- `POST /api/payments/manual` records a confirmed offline payment.
- `POST /api/payments/manual/refunds` records a confirmed offline refund, including source-aware sequential refunds across multiple manual settlements.
- `POST /api/payments/stripe/refunds` creates a server-authorized source-aware Stripe refund operation, including sequential refunds across multiple Stripe settlements.
- `POST /api/payments/stripe/reconcile` reconciles one tenant-owned pending Stripe authorization/capture transaction.
- `POST /api/payments/stripe/refunds/reconcile` reconciles one tenant-owned pending Stripe refund.
- `POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout` creates or resumes the capability-owned hosted Checkout operation.
- `POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout/status` returns customer-safe authoritative payment/recovery state.
- `POST /api/webhooks/stripe/[organization-id]` verifies and ingests tenant-specific Stripe callbacks, including provider-known amendment evidence through the isolated amendment finalizer.
- `GET /api/payments/transactions?bookingId=...` returns paginated tenant-scoped history.
- `GET|POST /api/bookings/hospitality/[booking-id]/commercial-amendments` discovers or prepares a reviewed non-zero commercial amendment.
- `GET /api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]` returns server-derived amendment orchestration state.
- `POST .../[amendment-id]/manual-settlement` records a real completed external manual adjustment.
- `POST .../[amendment-id]/stripe-refund` executes the next server-selected amendment refund source.
- `POST .../[amendment-id]/stripe-refund/status` performs exact retry or provider reconciliation for the single unresolved amendment Stripe refund.
- `POST .../[amendment-id]/apply` invokes the final serializable apply boundary after authoritative settlement proves readiness.
- `POST .../[amendment-id]/cancel` invokes guarded cancellation before adjustment money has settled.

The commercial-amendment product transport never accepts organization identity, money amounts, currency, payment provider, refund source, provider reference, settlement truth, or apply authority from the browser. Manual references and request idempotency identities are inputs to already server-authorized operations; the service re-derives every financial and tenant/resource invariant before mutation. Stripe additional-charge customer authorization is intentionally not exposed yet.

BigInt money is serialized as decimal strings. Internal provider-call claim references are serialized as `null` rather than exposed as real provider identifiers.

Organization `ADMIN` and `MANAGER` roles receive `payment:read` and `payment:manage`; `STAFF` receives `payment:read`; `CUSTOMER` receives no internal ledger capability. Public booking payment uses a separate encrypted capability and persisted booking/principal ownership. Webhooks have no user actor and may mutate state only after tenant-specific provider verification and tenant-owned resource resolution.

## Validation and remaining work

Dependency-free payment/amendment domain coverage includes settlement reconciliation, refund-source attribution, deterministic refund allocation/execution planning, whole-booking payment-state reconciliation, refund availability, provider normalization, Stripe request/recovery domains, public payment recovery, webhook-domain behavior, commercial-amendment settlement reconciliation, provider-neutral amendment execution decisions, commercial-amendment product transport state, Stripe amendment refund/charge recovery domains, signed amendment webhook candidate isolation, and final-apply consistency. Amendment apply coverage rejects booking version/current-term/current-price drift, target-selection drift, inventory-protection mismatches, target-price drift, and adjustment-identity drift before mutation.

The focused commercial-amendment transport-state suite passes 5/5 under the available runtime, and the new transport/service/route/component files pass the available TypeScript syntax parser. The manual/Stripe amendment service persistence, advisory-lock, idempotency, live provider behavior, verified-event promotion, UI-backed provider operations, and polling/webhook concurrency remain unclaimed until the guarded disposable PostgreSQL/provider environment can run.

The guarded disposable PostgreSQL suite remains the required validation gate for Prisma schema/migrations, locking, idempotency, provider persistence, webhook concurrency, source-attribution behavior, amendment-payment foreign keys, amendment executors, signed amendment callback finalization, product transport routes, and the final apply transaction. Do not claim that gate passed unless `npm run test:database` runs against an explicitly confirmed disposable PostgreSQL target.

Still open in this dependency cluster: fresh customer-authorized Stripe collection for normal amendment price increases, invoices/tax documents, and broader production provider operational validation. Expired-amendment recovery, authenticated manual adjustment recording, authenticated source-scoped Stripe amendment refunds, settlement proof, final apply, and recovery UI are real and implemented; do not regress to a fake redirect, browser-success model, browser-selected settlement source, browser-selected amendment payment identity, or browser-authorized apply.
