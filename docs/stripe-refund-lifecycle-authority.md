# Stripe refund lifecycle authority

## Purpose

Stripe refund success is not universally terminal. A refund can be `pending`, `requires_action`, `succeeded`, `failed`, or `canceled`; for payment methods that require recipient details, Stripe documents a lifecycle where a refund that was already `succeeded` can return to `requires_action`, later continue as `pending`, and eventually succeed or fail. Stripe also documents that a bank or card issuer can return refund funds to Stripe and cause the Refund object to become `failed` later.

SF must therefore not treat one successful webhook snapshot as permanent settlement truth. A refund that stops being successful must stop reducing the booking's net settled balance.

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

Commercial-amendment refunds remain owned by their specialized amendment recovery/finalization services. This pass deliberately does not infer rollback semantics for an already-applied commercial amendment.

## Booking-state recovery

Before applying provider truth, SF derives a baseline settlement state from the booking ledger **excluding the refund currently being reconciled**. That baseline is the state the booking must have when the refund is not successful.

The same ledger is used to re-derive the refund allocation and its successful post-refund payment state. The current booking status must equal one of those two states according to the refund's persisted lifecycle:

- `SUCCEEDED` refund → the successful post-refund payment state;
- `PENDING`, `AMBIGUOUS`, or `FAILED` refund → the baseline payment state.

This makes reconciliation bidirectional. A provider transition from `SUCCEEDED` back to a non-success state restores the booking to the baseline payment state. A later valid `PENDING`/`AMBIGUOUS` refund that succeeds applies the refund state again.

An exact current Stripe Refund retrieval outranks a stale local lifecycle snapshot. That means an SF row currently marked `FAILED` can be corrected if a later explicit retrieval of the same `re_*` object reports a different current state. This is intentionally limited to the same tenant-owned refund identity, source PaymentIntent, currency, and amount; SF does not infer a new refund operation from a different provider object.

## Webhook behavior

The public Stripe route still verifies framing, bounded raw-body acquisition, tenant-specific HMAC, and durable provider-event idempotency before lifecycle reconciliation. For already-bound normal refunds, the route then calls `reconcileVerifiedStripeRefundWebhook`, which retrieves current provider truth through the existing Stripe refund reconciliation adapter and updates the verified webhook ledger note.

Initial internal refund claims continue through the existing ingestion path. The lifecycle reconciler returns without claiming events for which no exact normal refund reference exists, allowing the commercial-amendment finalizers to retain ownership of their specialized operations.

## Explicit reconciliation

`reconcileStripeRefundTransaction` now supports exact normal Stripe refunds in `PENDING`, `AMBIGUOUS`, `SUCCEEDED`, and `FAILED` states. This provides an operator recovery path even when a provider update webhook was delayed or missed. It uses the same baseline-versus-successful booking-state rule and full tenant/booking/provider/source/money predicates at the final write.

Generic explicit reconciliation rejects commercial-amendment-owned refunds. Exact normal refunds can be reconciled from any persisted lifecycle when the same provider object, source, and money remain authoritative.

## Validation boundary

`src/server/payments/stripe-refund-lifecycle-domain.test.ts` protects the pure lifecycle and booking-state decisions. `scripts/stripe-refund-lifecycle-authority-contract.test.mjs` protects route wiring, verified-event authority, exact normal-refund ownership, current provider retrieval, full final-write predicates, commercial-amendment isolation, and the explicit reconciliation recovery path.

Full Node 24 / TypeScript 6 validation, Prisma migration execution, disposable PostgreSQL integration tests, and live Stripe refund-transition testing still require their provisioned environments. GitHub Actions are intentionally not used.
