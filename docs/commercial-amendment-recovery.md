# Commercial amendment expiry recovery

Commercial amendment expiry is not permission to discard provider money. A `PREPARED` hospitality commercial amendment that reaches its expiry time remains blocking whenever amendment-owned payment evidence shows unresolved or successful external activity. Recovery must restore authoritative booking settlement to the immutable pre-amendment total before the amendment can become terminal and release its target inventory protection.

## Recovery decision contract

`deriveHospitalityCommercialAmendmentRecoveryDecision` is the provider-neutral recovery authority for an expired amendment. It consumes the immutable before/after commercial snapshot plus the complete tenant-owned booking payment ledger and returns one of these states:

- `NOT_EXPIRED` — the normal amendment lifecycle still owns the operation.
- `WAIT_FOR_PROVIDER` — amendment-owned `PENDING` or `AMBIGUOUS` evidence must be reconciled before any compensation decision.
- `RELEASE_AUTHORIZATION` — an expired Stripe adjustment still has an uncaptured authorization that must be released rather than captured.
- `CAPTURE_COMPENSATION` — refund recovery already has an exact Stripe compensation authorization and must finish/reconcile that capture rather than create another charge.
- `COMPENSATE` — authoritative net settlement is between the prepared before/after totals but not back at the original total. The decision specifies the exact server-derived compensation direction and amount. Refund compensation is additionally bound to an adjustment-created settlement source.
- `READY_TO_EXPIRE` — authoritative net settlement is exactly the original booking total with no unresolved provider work. Recovery may safely release target protection and mark the amendment `EXPIRED`.
- `TERMINAL` or `CONFLICT` — no new recovery operation may be started.

The recovery domain fails closed when provider/currency identity drifts, successful booking money appears outside the amendment after preparation, unresolved unrelated payment activity exists, linked refund source attribution is missing, multiple uncaptured authorizations exist, authoritative net settlement cannot be explained by amendment-linked evidence, or money moves outside the immutable before/after price boundary.

For an expired additional-charge amendment, only settlement sources created by that amendment are eligible for compensating refunds. SF does not refund an arbitrary older booking payment just because it has a larger balance. For an expired refund amendment, compensation restores the original booking net settlement with a new charge; Stripe customer payment authority is still required before a fresh online compensation charge can be created.

## Manual recovery execution

`recordManualHospitalityBookingCommercialAmendmentRecovery` is an internal provider executor for real manual compensation events that already happened outside SF. It has no browser route or primary UI action.

The service requires both `booking:manage` and `payment:manage`, tenant-scopes the booking/amendment/ledger, serializes the tenant idempotency key plus shared booking mutation lock, verifies the booking is still the prepared confirmed/paid snapshot, and re-derives the recovery decision under a serializable transaction. Compensation amount and refund source are server-derived; the caller supplies only a bounded idempotency key and the real external manual reference.

Manual compensation payments/refunds remain linked through `commercialAmendmentId`, use recovery-specific request fingerprints, reject organization-level duplicate provider references, and write audit evidence. The manual adapter still does not move funds. A successful compensation operation never changes booking commercial terms or `HospitalityBooking.paymentStatus`.

When the post-write recovery decision becomes `READY_TO_EXPIRE`, the same transaction releases or expires the target hold, marks the amendment `EXPIRED`, and records `booking.commercial-amendment.recovery-completed`. `finalizeHospitalityBookingCommercialAmendmentRecovery` provides the same terminalization boundary for recovery completed through another provider path. Idempotent retries of an already-recorded manual compensation remain safe after the amendment becomes terminal.

## Stripe recovery execution

`executeStripeHospitalityBookingCommercialAmendmentRecovery` is the internal Stripe recovery orchestrator for provider work that can be completed without inventing new customer payment authority. It has no API route or primary UI action.

The service requires both management permissions, tenant-scopes the amendment, booking, and complete ledger, preserves the prepared booking snapshot, and serializes the shared booking/payment scopes. Every new provider operation uses a deterministic recovery idempotency key derived from booking, amendment, operation, and exact PaymentIntent source. Recovery fingerprints bind the same identity plus exact currency and minor-unit amount.

The Stripe adapter now exposes the normalized `RELEASE_AUTHORIZATION` capability. For `RELEASE_AUTHORIZATION`, SF retrieves current PaymentIntent truth before attempting cancellation. An exact `requires_capture` authorization is canceled through Stripe with a deterministic idempotency key. An already canceled authorization is recorded as released without another provider write. If Stripe proves the authorization actually settled, SF records deterministic matching `CAPTURE / SUCCEEDED` evidence instead of pretending the authorization was released. Unexpected partial or mismatched provider money fails closed.

For `CAPTURE_COMPENSATION`, SF likewise rechecks the exact authorization before capture. Recovery creates an amendment-owned `CAPTURE / AMBIGUOUS` claim bound to the known PaymentIntent before external capture. Successful provider truth becomes `SUCCEEDED`; definitive failures become `FAILED`; retryable or non-final states remain `AMBIGUOUS`. The booking payment/commercial snapshot is never rewritten by this recovery payment evidence.

For `COMPENSATE / REFUND`, SF can refund only the server-selected adjustment-created Stripe settlement source. It creates an amendment-owned `REFUND / AMBIGUOUS` claim before the provider call, persists the exact `sourceProviderReference`, and uses deterministic operation identity so an uncertain request can be retried without selecting a different source. A real Stripe refund reference replaces the internal claim only after the provider returns it.

`reconcileStripeHospitalityBookingCommercialAmendmentRecovery` polls provider truth for recovery-owned ambiguous captures and refunds that already have real provider references. It validates tenant, booking, amendment, provider identity, exact money, refund source, and persisted recovery fingerprint before changing only the payment/audit evidence. Generic booking payment finalizers remain unable to mutate `HospitalityBooking.paymentStatus` from these recovery rows.

When Stripe recovery restores authoritative net settlement to the original booking total, the shared recovery finalizer releases target protection and marks the amendment `EXPIRED`. If more source-scoped compensation remains, the next invocation re-derives the next provider operation from the current ledger.

## Remaining Stripe boundary

A refund amendment can leave authoritative booking settlement below the original total and therefore require a **fresh compensation charge**. SF does not create that charge without new customer payment authority. The production customer-facing Stripe collection/authentication transport must obtain that authority through a Stripe-hosted or Stripe.js flow, handle required customer authentication, and then feed provider evidence back into the amendment-owned recovery lifecycle.

Signed amendment webhook handling also still needs explicit recovery-operation fingerprint support before recovery-owned capture/refund rows should rely on callback convergence. The dedicated polling boundary is authoritative for the recovery rows implemented here.

Until the fresh compensation-charge transport and signed recovery webhook convergence exist, user-facing amendment settlement/apply orchestration remains closed. Internal recovery does not expose browser-selected amount, source, PaymentIntent, provider state, or amendment authority.

## Validation

The dependency-free recovery-domain suite covers no-money expiry, unresolved provider evidence, full and partial additional-charge compensation, refund compensation, restored-net terminalization, Stripe uncaptured authorization handling, exact compensation-authorization matching, post-prepare unrelated successful money, prepared price-bound violations, unexpired lifecycle isolation, and terminal amendments.

`booking-commercial-amendment-stripe-recovery-domain.test.ts` additionally covers deterministic recovery operation identity, money/source-bound fingerprints, exact releasable authorization truth, already-released truth, direct-settlement discovery, non-final provider states, provider drift, partial-cancel money rejection, and refund-reference validation.

`stripe-payment-provider.test.ts` covers the real Stripe cancellation request boundary and provider identity/money validation. The same adapter sweep also fixes exact partial-capture normalization so Stripe numeric minor units are converted to `bigint` before entering the normalized payment-money contract.

Database validation remains required for advisory-lock ordering, tenant predicates, recovery idempotency, provider persistence, target-hold release, amendment terminalization, and payment/audit persistence. Do not claim those PostgreSQL paths passed unless the guarded disposable database suite runs against an explicitly confirmed disposable target.
