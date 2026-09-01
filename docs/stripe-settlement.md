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

## Refund and receipt behavior

A directly settled authorization can now remain refundable through the same server-authorized Stripe refund path, provider-truth reconciliation, and verified refund-webhook finalization used for captured payments. Money, tenant ownership, booking state, provider reference, and refundable balance are still revalidated before mutation.

Receipt settlement retains the same successful authorization as the captured basis after the booking moves from `PAID` to `PARTIALLY_REFUNDED` or `REFUNDED`. This prevents a valid receipt from becoming unavailable solely because a refund changed the booking payment-state label.

This does not make browser redirects payment proof and does not create a customer-facing checkout flow. Provider-confirmed state and persisted SF ledger records remain authoritative.
