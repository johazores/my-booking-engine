# Stripe webhook payment-attempt authority

## Purpose

Stripe does not guarantee webhook delivery order, and distinct snapshot events can share the same second-level `created` timestamp. SF therefore must not decide which local payment attempt owns a PaymentIntent event from delivery order or event creation time. Provider event IDs still provide delivery idempotency; payment-attempt authority comes from tenant-scoped persisted payment identity and current lifecycle state.

This contract applies to the generic hospitality PaymentIntent webhook state machine in `src/server/payments/stripe-webhook-service.ts`. Checkout Session settlement and commercial-amendment provider flows retain their separate authority contracts.

## Exact provider identity outranks a pending claim

A signed PaymentIntent event first searches the locked booking for persisted Stripe `AUTHORIZATION`/`CAPTURE` operations already carrying the exact `pi_*` provider reference. If exact ownership exists, SF never falls through to a newer `sf_claim_*` pre-reference operation.

This matters after a definitive failure followed by a customer/staff retry. A later webhook for the older PaymentIntent must remain attached to that older operation; otherwise an out-of-order event could bind the old provider object onto the newer attempt and corrupt idempotency, settlement, and retry identity.

When no exact provider reference exists, the existing first-provider-evidence behavior remains available only for normal booking `PENDING` operations with `commercialAmendmentId = null`. Ambiguous or amendment-owned evidence is not eligible for generic claim binding.

## Monotonic recovery

An exact normal-booking operation in `FAILED` may be recovered only by positive PaymentIntent truth:

- `requires_capture` may recover the exact authorization operation;
- `succeeded` may recover the exact compatible capture/authorization operation.

This supports Stripe's PaymentIntent lifecycle, where a failed payment attempt can return the same PaymentIntent to `requires_payment_method` so another attempt can later move that provider object toward `requires_capture` or `succeeded`, without requiring SF to trust webhook delivery order.

Negative or still-incomplete snapshots do not reopen an already failed operation. A `SUCCEEDED` operation is never regressed by a later/stale event. An exact provider reference owned by an incompatible operation kind blocks fall-through to a different pending claim.

The final Prisma mutation repeats the selected transaction ID, tenant, booking, provider, exact kind, exact prior lifecycle (`PENDING` or the narrowly recoverable `FAILED`), persisted provider reference, currency, and amount. Booking payment-state mutation repeats the confirmed booking lifecycle, prior payment state, currency, and authoritative total.

## Specialized flow isolation

Commercial-amendment payment operations remain owned by their specialized webhook/finalization services. Exact evidence with `commercialAmendmentId != null` or `AMBIGUOUS` lifecycle is ignored by the generic PaymentIntent mutator. The public webhook route can then continue into the existing amendment finalizers using the already verified event.

The pending-claim fallback additionally requires `commercialAmendmentId = null`, preventing a malformed specialized lifecycle from becoming a generic booking payment merely because it is pending.

## Tenant and money authority

The existing webhook boundary remains authoritative for all surrounding checks:

- tenant-specific Stripe signature verification precedes durable processing;
- event metadata organization and booking must match the route tenant and locked booking;
- booking currency and total must equal the signed PaymentIntent money;
- exact provider-reference ownership is searched only inside the tenant and booking;
- binding a previously internal claim still checks for cross-booking provider-reference conflicts;
- webhook-event ID plus payload hash remain durable duplicate/conflict protection;
- the booking payment advisory lock and serializable transaction remain mandatory.

No browser redirect, event arrival order, timestamp comparison, or unscoped provider reference becomes commercial authority.

## Verification

`src/server/payments/stripe-webhook-payment-mutation-domain.test.ts` covers exact historical identity outranking a newer claim, positive recovery of exact failed operations, stale failure non-regression, specialized-flow isolation, incompatible exact ownership, first-provider-evidence binding, and fail-closed candidate contracts.

`scripts/stripe-webhook-payment-attempt-authority-contract.test.mjs` protects the service wiring: exact-reference lookup must happen before pending fallback, generic pending fallback must exclude commercial amendments, the pure decision boundary must be used, and final writes must retain the selected prior lifecycle instead of assuming every mutation starts from `PENDING`.

The existing database-backed Stripe payment integration suite remains the end-to-end PostgreSQL validation surface for webhook tenant scope and persistence. Full Node 24/TypeScript 6 validation, Prisma/PostgreSQL execution, production build, and live Stripe event-order testing require the repository-supported toolchain and explicitly disposable/provisioned environments. GitHub Actions are intentionally not used.

## Provider references

- Stripe webhook event-order guidance: <https://docs.stripe.com/webhooks#event-ordering>
- Stripe PaymentIntent lifecycle: <https://docs.stripe.com/payments/paymentintents/lifecycle>
