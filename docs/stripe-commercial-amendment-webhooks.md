# Stripe commercial amendment webhooks

SF handles provider-known commercial-amendment Stripe operations through the existing signed tenant webhook boundary without allowing callbacks to invent booking commercial state.

## Verified callback boundary

`POST /api/webhooks/stripe/[organization-id]` verifies the bounded raw request with the tenant-specific encrypted Stripe webhook secret and persists provider event ID, event type, payload hash, provider reference, booking identity when known, and processing outcome in `PaymentWebhookEvent`. Altered redelivery remains a conflict at this boundary.

After generic verification, commercial processing is deliberately layered:

1. normal booking refund lifecycle reconciliation gets first chance at exact ordinary refund references;
2. exact amendment-owned price-decrease refunds are passed to `reconcileVerifiedStripeCommercialAmendmentRefundWebhook`, which treats the signed event as a trigger and retrieves the current Stripe Refund object before changing payment evidence;
3. amendment Checkout settlement and Checkout recovery finalizers run for their exact Session ownership;
4. provider recovery finalization owns compensation operations;
5. the legacy normal amendment PaymentIntent/refund finalizer remains the fallback for provider-known unresolved operations that were not handled by the stronger lifecycle boundaries.

Each commercial layer receives the same persisted verified event ID and raw payload and independently requires the durable provider-event identity/hash before it can mutate payment evidence.

## Normal amendment refund lifecycle ownership

A real amendment-owned Stripe `re_*` refund reference is durable provider identity. Once that exact identity exists, refund success is not treated as terminal. Stripe can later report the same Refund as non-successful, including `requires_action`, `pending`, `failed`, or `canceled` states.

`reconcileVerifiedStripeCommercialAmendmentRefundWebhook` therefore accepts the signed callback only as a verified trigger. Before mutation it requires exact agreement across tenant, booking, amendment, refund transaction, provider reference, source PaymentIntent, currency, amount, deterministic amendment refund fingerprint, verified webhook ID/type/hash/reference, and immutable amendment provider/direction/money. It then retrieves the current Refund through the tenant-owned Stripe reconciliation adapter.

Current provider truth maps as follows:

- `succeeded` -> amendment payment evidence `SUCCEEDED`;
- `failed` or `canceled` -> `FAILED`;
- other valid non-final current states -> `AMBIGUOUS`.

The same exact refund can therefore move away from a previously recorded success or recover from a previous failure when current provider truth proves it. The webhook route stops further commercial finalization after this lifecycle boundary handles the event so an older signed snapshot cannot overwrite the current provider state just retrieved.

The lifecycle service changes only the exact amendment-owned `PaymentTransaction` and the verified `PaymentWebhookEvent`. It does not update `HospitalityBooking.paymentStatus`, booking totals/terms/allocation, target protection, or amendment pricing/status. If provider truth regresses after the amendment was already applied, SF exposes the resulting settlement contradiction to existing recovery/settlement guards instead of inventing an automatic commercial rollback.

## Initial normal amendment settlement ownership

Provider-known normal amendment operations that do not yet fall under the current-refund lifecycle remain isolated from generic booking payment finalizers:

- authorization/capture callbacks require the exact persisted PaymentIntent reference plus exact currency and minor-unit amount;
- initial refund finalization requires the exact persisted Stripe refund reference, source PaymentIntent, currency, amount, and deterministic refund fingerprint;
- duplicate provider-reference ownership outside the same authoritative operation fails closed;
- additional-charge callbacks reuse the same provider-state reconciliation contract as polling, including exact received/capturable money and deterministic direct-capture evidence when Stripe proves an authorization was already settled.

SF deliberately does **not** guess which amendment owns a webhook when the local row still contains only an internal `sf_claim_*` reference. A signed event proves Stripe sent the payload, but without a previously persisted provider reference it does not prove which unresolved local claim created that external object. Those pre-reference operations remain recoverable through the exact idempotent executor retry and provider polling paths.

## Expired-amendment recovery ownership

Recovery-owned callbacks have a separate identity contract because compensation direction is intentionally different from normal amendment settlement. A recovery `CAPTURE` can belong only to an expired `REFUND` amendment, while a recovery compensation `REFUND` can belong only to an expired `ADDITIONAL_CHARGE` amendment.

The exact amendment-refund lifecycle boundary checks amendment direction before applying ordinary refund fingerprint semantics. An `ADDITIONAL_CHARGE` compensation refund is therefore left unhandled for the recovery finalizer rather than being misclassified as a normal price-decrease refund.

Only provider-known `AMBIGUOUS` recovery rows with deterministic `ca-stripe-recovery-*` idempotency identity are eligible for recovery finalization. The recovery path re-derives and verifies the exact operation key and request fingerprint from tenant-owned booking ID, amendment ID, operation, provider source, currency, and minor-unit amount. Compensation refunds additionally require exact `sourceProviderReference` attribution and the signed refund PaymentIntent must match that persisted source.

PaymentIntent metadata is consistency evidence rather than ownership authority. If Stripe supplies SF organization or booking metadata it must agree with persisted tenant-scoped recovery ownership, but exact tenant/provider reference plus deterministic recovery identity remain authoritative. Cross-tenant, cross-booking, cross-amendment, duplicate-reference, money, source, or fingerprint drift fails closed.

Internal `sf_claim_*` recovery refunds remain intentionally excluded because a signed callback cannot safely invent which unresolved local claim created the Stripe object. Exact executor retry must first recover and persist the real `re_*` reference.

## State preservation

Normal amendment webhook paths update amendment-attributed `PaymentTransaction` evidence and verified webhook processing state only. They do not change booking payment status, booking commercial fields, booking allocation, target hold, amendment status, or the prepared booking version.

Recovery webhook finalization follows the same state-preservation rule. It updates only exact recovery payment evidence plus the verified webhook ledger. It does not terminalize the amendment or release inventory protection from the callback itself; the recovery service must re-derive authoritative net settlement and use the shared recovery finalizer when the original booking total is restored.

The final normal booking mutation remains exclusively owned by `applyHospitalityBookingCommercialAmendment` after provider-neutral settlement reaches `READY_TO_APPLY` and the serializable apply transaction revalidates booking version, current/target commercial snapshots, target inventory protection, and authoritative pricing.

## Remaining recovery boundary

Provider-known normal amendment operations and provider-known recovery operations can converge through signed callbacks or their dedicated polling reconciliation services. Provider-unknown internal claims remain intentionally unresolved until exact retry establishes provider identity.

The remaining Stripe recovery dependency is a fresh customer-authorized compensation charge for an expired refund amendment whose net settlement is below the original booking total. That transport must obtain real Stripe customer payment authority and satisfy required authentication before feeding provider evidence into the amendment-owned recovery lifecycle. Until it exists, user-facing recovery remains closed where that authority is required.

## Validation

`booking-commercial-amendment-stripe-webhook-domain.test.ts` covers exact normal PaymentIntent/refund selection, exact money/source enforcement, duplicate-reference ambiguity, and refusal to guess internal pre-reference claims.

`booking-commercial-amendment-stripe-refund-domain.test.ts` covers current refund state mapping and non-terminal lifecycle transitions. `scripts/stripe-commercial-amendment-refund-lifecycle-authority-contract.test.mjs` protects route ordering, verified event authority, exact amendment/refund/source/money ownership, current provider retrieval, no booking/amendment mutation, and the compensation-refund ownership split.

`booking-commercial-amendment-stripe-recovery-webhook-domain.test.ts` covers exact recovery capture/refund identity, deterministic operation key and request fingerprint enforcement, refund-source binding, and missing-source rejection. Database-backed validation of webhook locking, signed-callback/polling races, post-success provider regressions, and recovery persistence remains gated on an explicitly confirmed disposable PostgreSQL target.

GitHub Actions are not used for this validation path.
