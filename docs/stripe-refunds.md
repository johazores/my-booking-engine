# Stripe Refunds

SF issues Stripe refunds only through server-side payment boundaries. The browser never supplies authoritative money, provider credentials, settlement-source references, or Stripe Refund/PaymentIntent identity.

## Normal booking refunds

`refundStripeBookingPayment` requires `payment:manage`, tenant-scopes the booking, and derives refund authority from the complete booking payment ledger. `deriveBookingRefundExecutionPlan` reconciles net settled money, deterministically selects the next refundable Stripe settlement source, calculates the exact source-scoped operation amount, and derives the resulting whole-booking payment status. Multiple successful Stripe settlement sources are supported sequentially; one refund operation never silently spans sources.

Refund amounts use exact integer minor units. Omitting `amountMinor` means refund the selected source's remaining balance. An explicit amount cannot exceed that source's remaining balance. Explicit-amount and refund-remaining requests use distinct request fingerprints so the same idempotency key cannot silently change intent.

Before calling Stripe, SF persists a tenant-scoped refund claim under the idempotency, booking-mutation, and payment advisory locks. The claim persists `sourceProviderReference`, binding the operation to the exact successful Stripe settlement source before external provider I/O. Exact unresolved retries reuse the same Stripe idempotency key and must re-derive the same source and amount. Different concurrent refund requests cannot both cross the provider boundary for the same authority.

Definitive provider failures close the exact internal claim; retryable transport or timeout uncertainty remains recoverable instead of being falsely reported as failed or refunded. Provider results are accepted only when provider code, source PaymentIntent, currency, amount, and real `re_*` reference match the claimed operation. Provider references cannot be reused by another tenant payment transaction.

The shared settlement reconciler consumes persisted refund-source attribution. A successful refund must resolve to an effective successful source from the same provider and cannot exceed that source's remaining settled money. Legacy refund rows without source attribution are accepted only when there is exactly one effective provider source; ambiguous multi-source histories fail closed.

`POST /api/payments/stripe/refunds` is the authenticated same-origin management boundary. The request contains `bookingId`, `idempotencyKey`, and optional `amountMinor`; the server selects settlement source and all authoritative money.

## Provider-truth lifecycle reconciliation

Stripe refund success is not universally terminal. Stripe documents failed refunds where funds are returned to the Stripe balance after an earlier refund, and payment methods whose refunds can move from `succeeded` back to `requires_action`, then `pending`, before later succeeding or failing. SF therefore treats the exact current Refund object as stronger lifecycle evidence than a stale local success snapshot.

`POST /api/payments/stripe/refunds/reconcile` accepts a tenant-owned normal Stripe refund with a real `re_*` provider reference in `PENDING`, `AMBIGUOUS`, `SUCCEEDED`, or `FAILED`. The caller supplies only the SF payment transaction ID; tenant scope and Stripe credentials resolve server-side and `payment:manage` remains mandatory.

The read-only reconciliation adapter uses `GET /v1/refunds/:id`. SF verifies exact refund ID, source PaymentIntent, currency, and amount, then re-reads the complete tenant booking ledger under booking/payment locks. The baseline ledger excluding the refund determines the booking state when the refund is not successful; the authoritative refund plan determines the state when it is successful.

Current Stripe `succeeded` maps to `SUCCEEDED`; `failed` or `canceled` maps to `FAILED`; other valid current states remain non-successful (`PENDING` for normal booking refunds). A previously successful exact refund that is no longer successful therefore stops reducing net settlement and restores the booking to the ledger-derived baseline state. A later current provider success can apply the refund again. Exact identity/source/money predicates prevent this recovery rule from inventing a different refund operation.

## Verified refund webhook finalization

`POST /api/webhooks/stripe/[organization-id]` verifies bounded raw payload framing and the tenant-specific Stripe signature before parsing. The tenant/provider webhook ledger provides event-ID idempotency and altered-event conflict detection.

For an initial normal refund callback, SF can bind a real `re_*` reference only to an exact pending claim whose persisted source PaymentIntent and money match the signed refund object; multiple candidates fail closed. Once the real provider reference is bound, `reconcileVerifiedStripeRefundWebhook` treats signed refund events as verified triggers and retrieves current Stripe Refund truth before changing an already-bound normal refund lifecycle.

Normal refund finalization always revalidates the complete tenant booking ledger and authoritative source allocation under booking/payment locks. Successful current truth updates booking payment state from whole-booking net settlement. Non-successful current truth does not claim refunded money. Safe webhook persistence stores event identity/hash, provider reference, derived booking ID, processing status/note, and timestamps; secrets, card data, and raw request bodies are not copied into audit evidence.

## Commercial amendment refunds

Commercial price-decrease refunds are amendment-owned and never use normal booking-refund state mutation. `refundStripeHospitalityBookingCommercialAmendment` requires `booking:manage` and `payment:manage`, tenant-scopes the booking and prepared amendment, and derives exact Stripe source and amount from the full ledger plus immutable amendment delta. It writes `commercialAmendmentId`, `sourceProviderReference`, and a deterministic amendment refund fingerprint; the caller cannot choose money or settlement source.

Before the Stripe write, the amendment refund is persisted as `AMBIGUOUS` with an internal `sf_claim_*` reference. Exact retries re-derive the same amendment execution decision and reuse the same Stripe idempotency key. Definitive provider failure closes only the exact unresolved internal claim. A provider response with a real `re_*` identity is persisted with `SUCCEEDED`, `FAILED`, or `AMBIGUOUS` according to provider state while booking/commercial state remains unchanged until the serializable amendment apply boundary.

An internal pre-reference `sf_claim_*` is never guessed from a signed callback. Exact retry/recovery must establish the real `re_*` identity first. Once that exact identity exists, `reconcileVerifiedStripeCommercialAmendmentRefundWebhook` owns signed lifecycle updates before the legacy commercial-amendment webhook finalizer. The signed event must match the durable event ledger, persisted refund identity, source PaymentIntent, amendment ownership/fingerprint, currency, and amount; SF then retrieves the current Refund object through the tenant-owned Stripe reconciliation adapter.

Commercial-amendment refund success is not treated as terminal. Current Stripe `succeeded` maps to `SUCCEEDED`; `failed`/`canceled` maps to `FAILED`; `requires_action`, `pending`, and other valid non-final states map to `AMBIGUOUS`. The same exact refund can move between these states as current provider truth changes.

Lifecycle reconciliation intentionally changes only the amendment-owned `PaymentTransaction` and verified webhook processing evidence. It does not rewrite booking totals, booking payment status, amendment pricing, target inventory, or an already-applied amendment. If a refund regresses after the amendment was applied, the truthful non-successful transaction makes the settlement contradiction visible to existing guards; SF does not invent an automatic commercial rollback. Operator compensation or replacement refund remains a separate explicit recovery action.

The exact amendment lifecycle boundary rechecks tenant, booking, amendment, provider, real refund reference, deterministic fingerprint, source PaymentIntent, currency, amount, and immutable amendment direction/money under booking/payment locks. A provider reference already owned by another transaction fails closed. Events handled by current lifecycle reconciliation are marked processed and do not continue into the older amendment finalizer, preventing a stale signed snapshot from overwriting freshly retrieved provider truth.

See `docs/stripe-refund-lifecycle-authority.md` and `docs/stripe-commercial-amendment-webhooks.md` for the authority split and webhook ownership model.

## Validation

Focused unit coverage includes Stripe refund domain/reconciliation, source attribution, refund allocation/execution planning, whole-booking payment-state recovery, amendment-owned refund claim/fingerprint/provider mapping, and non-terminal amendment lifecycle transitions. Source contracts protect route ordering, verified-event authority, current provider retrieval, exact final-write predicates, amendment isolation, and the rule that amendment lifecycle reconciliation does not mutate booking/commercial state.

The guarded PostgreSQL suite includes Stripe refund webhook integration coverage, but database-backed validation of the newer source-aware and amendment lifecycle concurrency paths still requires an explicitly confirmed disposable PostgreSQL target. Full Node 24 / TypeScript 6 validation, Prisma migration/drift execution, and live Stripe refund-transition validation also remain environment gates. GitHub Actions are intentionally not used. Browser redirects are never proof of payment or refund finality.
