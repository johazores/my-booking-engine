# Stripe refund lifecycle authority

## Purpose

Stripe refund success is not universally terminal. A refund can be `pending`, `requires_action`, `succeeded`, `failed`, or `canceled`; for payment methods that require recipient details, Stripe documents a lifecycle where a refund that was already `succeeded` can return to `requires_action`, later continue as `pending`, and eventually succeed or fail. Stripe also documents that a bank or card issuer can return refund funds to Stripe and cause the Refund object to become `failed` later.

SF must therefore not treat one successful webhook snapshot as permanent settlement truth. A refund that stops being successful must stop reducing the relevant authoritative settlement ledger.

Provider references:

- <https://docs.stripe.com/refunds#failed-refunds>
- <https://docs.stripe.com/refunds#requires-action>
- <https://docs.stripe.com/refunds#refund-events>
- <https://docs.stripe.com/api/refunds/object>

## Authority model

The normal hospitality refund lifecycle has two stages.

1. The existing signed webhook ingestion path may bind the first exact Stripe `re_*` reference to a pending SF refund claim after tenant, booking, source-settlement, currency, amount, idempotency, and provider-reference checks.
2. Once a normal refund already has an exact Stripe reference, `reconcileVerifiedStripeRefundWebhook` treats the signed webhook only as a verified trigger. It retrieves the current Refund object through the tenant-owned Stripe adapter before changing commercial state.

The second stage requires all of the following before mutation:

- the route tenant is a valid organization UUID;
- the supplied webhook ledger row belongs to that tenant and Stripe provider;
- provider event ID, event type, payload hash, and refund reference exactly match the verified ledger entry;
- the refund is a normal booking refund with `commercialAmendmentId = null`;
- the persisted `re_*` reference, PaymentIntent source, currency, and amount match the verified event and retrieved provider object;
- the booking remains tenant-owned and confirmed;
- the refund still matches the authoritative settlement-source allocation under booking and payment locks;
- the booking payment state still matches the ledger-derived state expected from the current local refund lifecycle.

Commercial-amendment refunds keep separate amendment ownership and never flow through normal booking payment-state mutation. Exact amendment-owned `re_*` refunds now use the same provider-truth principle through `reconcileVerifiedStripeCommercialAmendmentRefundWebhook`: a signed event is a trigger, while the current tenant-owned Stripe Refund retrieval is settlement authority.

## Booking-state recovery

Before applying provider truth for a normal booking refund, SF derives a baseline settlement state from the booking ledger **excluding the refund currently being reconciled**. That baseline is the state the booking must have when the refund is not successful.

The same ledger is used to re-derive the refund allocation and its successful post-refund payment state. The current booking status must equal one of those two states according to the refund's persisted lifecycle:

- `SUCCEEDED` refund → the successful post-refund payment state;
- `PENDING`, `AMBIGUOUS`, or `FAILED` refund → the baseline payment state.

This makes normal booking refund reconciliation bidirectional. A provider transition from `SUCCEEDED` back to a non-success state restores the booking to the baseline payment state. A later valid `PENDING`/`AMBIGUOUS` refund that succeeds applies the refund state again.

An exact current Stripe Refund retrieval outranks a stale local lifecycle snapshot. That means an SF row currently marked `FAILED` can be corrected if a later explicit retrieval of the same `re_*` object reports a different current state. This is intentionally limited to the same tenant-owned refund identity, source PaymentIntent, currency, and amount; SF does not infer a new refund operation from a different provider object.

## Commercial-amendment refund recovery

Commercial-amendment refund money remains amendment-owned because applying the amendment changes the booking's commercial snapshot only through the existing serializable apply boundary. Provider-truth lifecycle reconciliation therefore updates only the exact `PaymentTransaction` plus the verified webhook ledger; it does **not** rewrite booking totals, booking payment status, amendment pricing, target inventory, or an applied amendment.

This separation is important after apply. If Stripe later reports that an exact amendment refund which SF had recorded as `SUCCEEDED` is now `requires_action`, `pending`, `failed`, or `canceled`, SF persists that current provider truth instead of leaving stale successful money evidence. The resulting ledger inconsistency is intentionally visible to existing settlement/recovery guards rather than inventing an automatic rollback of an already-applied commercial amendment. Compensation or a replacement refund remains a separate explicit recovery action.

Before any lifecycle mutation, SF requires the exact tenant, booking, amendment, refund transaction, deterministic amendment refund fingerprint, source PaymentIntent, currency, amount, verified webhook event identity/hash/reference, and current Stripe Refund object to agree. It rechecks the same immutable amendment money/direction/provider authority under booking and payment locks. A provider reference already owned by another payment transaction fails closed.

`SUCCEEDED` is therefore not terminal for amendment-owned refunds either:

- Stripe `succeeded` maps to `SUCCEEDED`;
- Stripe `failed` or `canceled` maps to `FAILED`;
- other valid current states, including `requires_action` and `pending`, map to `AMBIGUOUS`;
- the same current status is retained idempotently;
- later current provider truth may move the same exact refund between those states in either direction.

Internal `sf_claim_*` amendment rows remain outside this exact-reference lifecycle boundary. SF does not guess which provider Refund object belongs to an internal pre-reference claim from amount/source alone; the existing exact idempotent provider retry/recovery path must first establish the real `re_*` identity.

## Webhook behavior

The public Stripe route still verifies framing, bounded raw-body acquisition, tenant-specific HMAC, and durable provider-event idempotency before lifecycle reconciliation. For already-bound normal refunds, the route calls `reconcileVerifiedStripeRefundWebhook`. It then gives exact amendment-owned refund references to `reconcileVerifiedStripeCommercialAmendmentRefundWebhook` before the older commercial-amendment finalizers.

When the amendment lifecycle reconciler handles the event, it marks that verified event processed and the route stops further commercial finalization for the same event. This prevents an out-of-order signed refund snapshot from overwriting the current provider state that SF just retrieved. Events with no exact amendment refund reference continue to the existing specialized finalizers, preserving internal-claim and other commercial-amendment behavior.

## Explicit reconciliation

`reconcileStripeRefundTransaction` supports exact normal Stripe refunds in `PENDING`, `AMBIGUOUS`, `SUCCEEDED`, and `FAILED` states. This provides an operator recovery path even when a provider update webhook was delayed or missed. It uses the same baseline-versus-successful booking-state rule and full tenant/booking/provider/source/money predicates at the final write.

Generic explicit reconciliation rejects commercial-amendment-owned refunds. Amendment-owned explicit recovery remains in its dedicated commercial-amendment transport/recovery boundary; this pass strengthens signed exact-reference lifecycle updates without widening customer-facing commercial-amendment actions.

## Validation boundary

`src/server/payments/stripe-refund-lifecycle-domain.test.ts` protects normal refund lifecycle and booking-state decisions. `src/server/bookings/booking-commercial-amendment-stripe-refund-domain.test.ts` protects amendment provider-state mapping and non-terminal lifecycle transitions. `scripts/stripe-commercial-amendment-refund-lifecycle-authority-contract.test.mjs` protects route ordering, exact amendment ownership, current provider retrieval, final write predicates, verified-event processing, and the no-booking-mutation boundary.

Full Node 24 / TypeScript 6 validation, Prisma migration execution, disposable PostgreSQL integration tests, and live Stripe refund-transition testing still require their provisioned environments. GitHub Actions are intentionally not used.
