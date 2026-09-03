# Stripe commercial amendment webhooks

SF finalizes provider-known commercial-amendment Stripe operations through the existing signed tenant webhook boundary without allowing those callbacks to mutate booking commercial state before final apply.

## Verified callback boundary

`POST /api/webhooks/stripe/[organization-id]` continues to verify the raw request with the tenant-specific encrypted Stripe webhook secret and persists the provider event ID, type, payload hash, provider reference, booking identity when known, and processing outcome in `PaymentWebhookEvent`.

After that generic verification/ingestion succeeds, `finalizeVerifiedStripeCommercialAmendmentWebhook` may promote an otherwise ignored Stripe event when it exactly matches amendment-owned payment evidence. The amendment finalizer requires the same persisted verified event ID, provider event ID, event type, and payload hash before it can change payment evidence. Altered re-deliveries remain conflicts at the existing webhook boundary.

## Exact provider-reference ownership

The amendment callback path intentionally consumes only `AMBIGUOUS` Stripe transactions that already persist the real provider reference returned by Stripe:

- authorization/capture callbacks require the exact persisted PaymentIntent reference plus exact currency and minor-unit amount;
- refund callbacks require the exact persisted Stripe refund reference, exact source PaymentIntent reference, exact currency, and exact minor-unit amount;
- duplicate provider-reference ownership outside the same amendment fails closed;
- refund request fingerprints and source attribution are revalidated before finalization;
- additional-charge callbacks re-use the same provider-state reconciliation contract as polling, including exact received/capturable money and deterministic direct-capture evidence when Stripe proves an authorization was already settled.

SF deliberately does **not** guess which amendment owns a webhook when the local row still contains only an internal `sf_claim_*` reference. A signed event proves Stripe sent the payload, but without a previously persisted provider reference it does not by itself prove which same-booking amendment claim created that external object. Those pre-reference ambiguous operations remain recoverable through the exact idempotent executor retry and provider polling paths. If lifecycle expiry prevents a safe retry, operator recovery/compensation remains required.

## State preservation

Amendment webhook finalization updates only amendment-attributed `PaymentTransaction` evidence and the verified `PaymentWebhookEvent` processing state. It does not change `HospitalityBooking.paymentStatus`, booking commercial fields, booking allocation, target hold, amendment status, or the prepared booking version.

The final booking mutation remains exclusively owned by `applyHospitalityBookingCommercialAmendment` after provider-neutral settlement reaches `READY_TO_APPLY` and the serializable apply transaction revalidates booking version, current/target commercial snapshots, target inventory protection, and authoritative pricing.

## Recovery boundary

Provider-known `AMBIGUOUS` authorization, capture, and refund evidence can now converge through either signed webhook truth or the existing dedicated read-only polling reconciliation services. Provider-unknown internal claims remain intentionally unresolved until an exact retry obtains a provider reference.

Expired-hold/payment compensation and recovery is still required before any customer-facing or staff-facing commercial-amendment settlement/apply action is exposed. In particular, SF must define how to preserve or compensate real provider money if the amendment expires or final apply later conflicts after external settlement.

## Validation

`booking-commercial-amendment-stripe-webhook-domain.test.ts` covers exact PaymentIntent/refund selection, exact money/source enforcement, duplicate-reference ambiguity, and the intentional refusal to guess internal pre-reference claims. Database-backed validation of webhook locking, verified-event promotion, concurrent polling/webhook finalization, and direct-capture persistence remains gated on an explicitly confirmed disposable PostgreSQL target.

GitHub Actions are not used for this validation path.
