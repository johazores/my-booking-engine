# Stripe commercial amendment webhooks

SF finalizes provider-known commercial-amendment Stripe operations through the existing signed tenant webhook boundary without allowing those callbacks to mutate booking commercial state before final apply or recovery completion.

## Verified callback boundary

`POST /api/webhooks/stripe/[organization-id]` continues to verify the raw request with the tenant-specific encrypted Stripe webhook secret and persists the provider event ID, type, payload hash, provider reference, booking identity when known, and processing outcome in `PaymentWebhookEvent`.

After that generic verification/ingestion succeeds, SF checks the event in two explicit commercial-amendment layers. `finalizeVerifiedStripeCommercialAmendmentRecoveryWebhook` runs first for expired-amendment recovery operations. If it does not handle the event, `finalizeVerifiedStripeCommercialAmendmentWebhook` may promote an otherwise ignored normal amendment-settlement event. Both boundaries require the same persisted verified event ID, provider event ID, event type, and payload hash before they can change payment evidence. Altered re-deliveries remain conflicts at the existing webhook boundary.

## Normal amendment settlement ownership

The normal amendment callback path intentionally consumes only `AMBIGUOUS` Stripe transactions that already persist the real provider reference returned by Stripe:

- authorization/capture callbacks require the exact persisted PaymentIntent reference plus exact currency and minor-unit amount;
- refund callbacks require the exact persisted Stripe refund reference, exact source PaymentIntent reference, exact currency, and exact minor-unit amount;
- duplicate provider-reference ownership outside the same amendment fails closed;
- refund request fingerprints and source attribution are revalidated before finalization;
- additional-charge callbacks re-use the same provider-state reconciliation contract as polling, including exact received/capturable money and deterministic direct-capture evidence when Stripe proves an authorization was already settled.

SF deliberately does **not** guess which amendment owns a webhook when the local row still contains only an internal `sf_claim_*` reference. A signed event proves Stripe sent the payload, but without a previously persisted provider reference it does not by itself prove which same-booking amendment claim created that external object. Those pre-reference ambiguous operations remain recoverable through the exact idempotent executor retry and provider polling paths.

## Expired-amendment recovery ownership

Recovery-owned callbacks have a separate identity contract because compensation direction is intentionally different from normal amendment settlement. A recovery `CAPTURE` can belong only to an expired `REFUND` amendment, while a recovery compensation `REFUND` can belong only to an expired `ADDITIONAL_CHARGE` amendment. Running the recovery finalizer first prevents those valid reverse-direction operations from being interpreted by the normal amendment finalizer.

Only provider-known `AMBIGUOUS` recovery rows with deterministic `ca-stripe-recovery-*` idempotency identity are eligible. The finalizer re-derives and verifies the exact recovery operation key and request fingerprint from tenant-owned booking ID, amendment ID, operation, provider source, currency, and minor-unit amount. Compensation refunds additionally require exact `sourceProviderReference` attribution and the signed refund's PaymentIntent must match that persisted source.

PaymentIntent metadata is additional consistency evidence rather than the ownership authority. If Stripe supplies SF organization or booking metadata it must agree with the tenant-scoped persisted recovery operation, but a callback can still be bound safely from the exact tenant/provider reference plus deterministic recovery identity when metadata is absent. Cross-tenant, cross-booking, cross-amendment, duplicate-reference, money, source, or fingerprint drift fails closed.

Internal `sf_claim_*` recovery refunds remain intentionally excluded because a signed callback cannot safely invent which unresolved local claim created the Stripe object. Exact executor retry must first recover and persist the real `re_` reference.

## State preservation

Normal amendment webhook finalization updates only amendment-attributed `PaymentTransaction` evidence and the verified `PaymentWebhookEvent` processing state. It does not change `HospitalityBooking.paymentStatus`, booking commercial fields, booking allocation, target hold, amendment status, or the prepared booking version.

Recovery webhook finalization follows the same state-preservation rule. It updates only the exact recovery payment evidence plus the verified webhook ledger. It does not terminalize the amendment or release inventory protection from the callback itself; the recovery service must first re-derive authoritative net settlement and then use the shared recovery finalizer when the original booking total is restored.

The final normal booking mutation remains exclusively owned by `applyHospitalityBookingCommercialAmendment` after provider-neutral settlement reaches `READY_TO_APPLY` and the serializable apply transaction revalidates booking version, current/target commercial snapshots, target inventory protection, and authoritative pricing.

## Remaining recovery boundary

Provider-known ambiguous normal amendment operations and provider-known recovery capture/refund operations can converge through either signed webhook truth or their dedicated polling reconciliation services. Provider-unknown internal claims remain intentionally unresolved until an exact retry obtains a provider reference.

The remaining Stripe recovery dependency is a fresh customer-authorized compensation charge for an expired refund amendment whose net settlement is below the original booking total. That transport must obtain real Stripe customer payment authority and satisfy required authentication before feeding provider evidence into the amendment-owned recovery lifecycle. Until it exists, user-facing amendment settlement/apply orchestration remains closed.

## Validation

`booking-commercial-amendment-stripe-webhook-domain.test.ts` covers exact normal PaymentIntent/refund selection, exact money/source enforcement, duplicate-reference ambiguity, and the intentional refusal to guess internal pre-reference claims.

`booking-commercial-amendment-stripe-recovery-webhook-domain.test.ts` covers exact recovery capture/refund identity, deterministic operation key and request fingerprint enforcement, refund-source binding, and missing-source rejection. Database-backed validation of webhook locking, verified-event promotion, signed-callback/polling races, and recovery persistence remains gated on an explicitly confirmed disposable PostgreSQL target.

GitHub Actions are not used for this validation path.
