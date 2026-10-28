# Stripe settlement source

SF normally records a successful Stripe `CAPTURE` row as the refund and receipt settlement source. A provider-proven `AUTHORIZATION` row may also represent already-settled money when Stripe reports the PaymentIntent as succeeded before a separate capture row is persisted.

## Source selection

Refund creation, refund reconciliation, verified refund webhooks, and payment receipts now use one consistent rule:

- prefer exactly one successful real Stripe `CAPTURE` row;
- when no successful capture exists, allow exactly one successful real Stripe `AUTHORIZATION` row only when the booking payment state already proves settlement (`PAID`, `PARTIALLY_REFUNDED`, or `REFUNDED`);
- never treat an `AUTHORIZED` booking as settled money;
- never use internal `sf_claim_*` references as provider truth;
- fail closed when multiple successful candidates make the settlement source ambiguous.

The fallback exists for provider-truth recovery, not to weaken the authorization/capture model. A normal manual-capture Stripe flow still prefers its persisted capture row.

## Provider response identity

Stripe capture, authorization release, and refund writes must not accept a different PaymentIntent or Refund object from the one being operated on. A refund write also requires the exact requested source PaymentIntent and a real `re_*` reference. PaymentIntent and Refund GET reconciliation independently reject response IDs that differ from the requested reference. A successful authorization or capture requires an explicit matching `amount_received`; SF never substitutes the requested amount as evidence of provider settlement. Invalid provider identity or missing settlement evidence remains retryable unknown provider truth and does not authorize a settled ledger write.

## Refund and receipt behavior

A directly settled authorization can now remain refundable through the same server-authorized Stripe refund path, provider-truth reconciliation, and verified refund-webhook finalization used for captured payments. Money, tenant ownership, booking state, provider reference, and refundable balance are still revalidated before mutation.

Receipt settlement retains the same successful authorization as the captured basis after the booking moves from `PAID` to `PARTIALLY_REFUNDED` or `REFUNDED`. This prevents a valid receipt from becoming unavailable solely because a refund changed the booking payment-state label.

This does not make browser redirects payment proof and does not create a customer-facing checkout flow. Provider-confirmed state and persisted SF ledger records remain authoritative.

## Database-enforced PaymentIntent booking ownership

The checked-in PostgreSQL `btree_gist` exclusion constraint forbids the same real Stripe `pi_*` reference from appearing on different bookings inside one tenant, regardless of payment kind, status, or commercial-amendment ownership. Multiple same-booking authorization/capture rows remain valid. Historical conflicting evidence blocks migration; no rows are silently reassigned. Existing tenant-scoped application checks and exact provider-truth reconciliation remain required. Disposable PostgreSQL execution and live Stripe verification have not been performed.
