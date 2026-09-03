# Commercial booking adjustments

SF has an authenticated, tenant-scoped price-impact review contract, a durable amendment boundary for non-zero commercial booking changes, amendment-attributed settlement/reconciliation, a provider-neutral execution-decision contract, real manual adjustment recording, source-scoped Stripe amendment refunds with reconciliation, provider-known signed amendment webhook finalization, explicit expired-amendment recovery, recovery-owned signed callback convergence, and a final serializable apply boundary. The booking workspace now orchestrates reviewed non-zero changes through preparation, safe provider-specific settlement states, reconciliation, cancellation, and final apply. Fresh customer-authorized Stripe collection for normal price increases remains deliberately closed rather than exposing the internal PaymentMethod executor as browser authority.

## Price review

`POST /api/bookings/hospitality/[booking-id]/modify/preview` accepts normalized room type, rate plan, room quantity, add-on selections, and a booking idempotency key. Organization and actor authority come from the authenticated request context and require `booking:manage`.

The server re-reads the tenant-owned confirmed booking, validates active room/rate assignment and traveler occupancy, recalculates transactional pricing, and compares immutable current money with the proposed quote using integer minor units only. It returns current/proposed components, signed delta, booking version, selection fingerprint, and deterministic adjustment fingerprint.

`ADDITIONAL_CHARGE` and `REFUND` are price-delta directions only. They are not browser authority to charge or refund money.

## Durable amendment preparation

`prepareHospitalityBookingCommercialAmendment` remains the authoritative preparation service. The authenticated commercial-amendment transport now exposes it only after a server price review, and accepts the reviewed adjustment fingerprint rather than browser-supplied money or settlement authority.

Preparation requires `booking:manage` and `payment:manage`, serializes on shared booking/inventory advisory locks, and revalidates the tenant-owned booking, current allocation, room/rate assignment, occupancy, restrictions, add-ons, transactional pricing, payment settlement, and target inventory before persisting immutable before/after commercial snapshots.

A prepared amendment uses the normal availability-hold core only for inventory that would otherwise be lost while payment is arranged: the full target quantity for a room-type change or incremental units for a same-room quantity increase. Its lifetime is bounded to 15 minutes. Rate/add-on-only changes and quantity decreases do not create artificial holds but retain the same bounded review lifetime.

## Concurrent mutation boundary

A `PREPARED` amendment is an exclusive commercial-change window while it is inside its review lifetime. Cancellation, rescheduling, traveler changes, zero-delta commercial mutations, refund availability, and refund writes fail closed while it is active. Payment write boundaries use the same booking mutation lock so settlement cannot change underneath the prepared snapshot.

Clock expiry alone is not disposal authority once amendment-attributed payment activity exists. An expired `PREPARED` amendment with `PENDING`, `AMBIGUOUS`, or `SUCCEEDED` linked payment evidence remains blocking and must be reconciled or compensated before another booking/payment mutation can proceed. Automatic expiry and explicit cancellation are allowed only when the amendment has no linked payment activity or every linked attempt is definitively `FAILED`; they must not release target inventory protection or erase the recovery boundary while external money may exist.

## Settlement and refund boundary

`deriveBookingSettlementSummary` provides authoritative net settled money from the tenant-owned payment ledger. It de-duplicates matching authorization/capture evidence, attributes successful refunds to the settlement source they reduce, exposes per-source remaining balances, and fails closed on unresolved, cross-currency, duplicated, internal-claim, unknown-source, or over-refunded history.

`PaymentTransaction.sourceProviderReference` persists refund attribution. Legacy unattributed refunds remain acceptable only when attribution is unambiguous because the provider has one effective source.

`deriveNextBookingRefundSource` defines deterministic provider-neutral source allocation from reconciled balances. It chooses the source with the largest refundable balance; ties use stable provider/reference lexical order. It ignores fully refunded sources and rejects mixed providers, mixed currencies, duplicate identities, or inconsistent balances. Browser input never selects the source.

`deriveBookingRefundExecutionPlan` composes that source decision with the full booking settlement and booking payment-state rules. A planned refund carries the exact provider/source, one-operation amount, total remaining booking balance, refundable-source count, and resulting whole-booking payment status. An explicit refund cannot silently span multiple sources.

Manual and Stripe refund boundaries consume this plan end to end. Multiple settlement sources from either supported provider can be refunded sequentially under tenant booking/mutation/idempotency locks. Every refund is attributed to its exact settlement source, and booking status is derived from whole-booking net settlement rather than the state of one source. Staff UI exposes the selected external manual payment reference when manual refund recording requires it; Stripe source selection remains entirely server-side.

Stripe exact retry, polling reconciliation, and signed webhook finalization re-derive the same deterministic source-aware plan before changing money state. A pending claim cannot silently migrate to another source after settlement drift, and signed refund callbacks bind Stripe's `payment_intent` to the persisted `sourceProviderReference` before accepting provider state.

Refund availability compares booking state to **net** settled money. This is required for repeat price adjustments: historical gross settlement may be higher than the current booking total after an attributed compensating refund while the current net amount is still exactly correct.

## Amendment settlement attribution

`PaymentTransaction.commercialAmendmentId` is the durable provider-neutral link between a payment/refund operation and the exact commercial amendment that authorized the price delta. The database foreign key binds `(commercialAmendmentId, bookingId, organizationId)` to the same amendment tuple, so an application bug cannot attach an adjustment payment to another tenant or another booking.

`deriveHospitalityCommercialAmendmentSettlementState` reconciles that linked evidence against the immutable before/after totals. It returns one of `REQUIRES_EXECUTION`, `IN_PROGRESS`, `READY_TO_APPLY`, or `CONFLICT`. It requires the persisted provider/currency/direction to agree, rejects unexplained booking-level settlement drift, rejects over-settlement and multiple unresolved amendment operations, treats standalone authorization as not yet settled, and supports source-split refund progress across multiple settlement sources without losing amendment attribution.

`deriveHospitalityCommercialAmendmentExecutionDecision` turns lifecycle plus already-reconciled settlement truth into one provider-neutral next-step decision: `EXECUTE`, `WAIT_FOR_PROVIDER`, `READY_TO_APPLY`, `RECOVERY_REQUIRED`, `EXPIRED`, `TERMINAL`, or `CONFLICT`. For a refund it accepts only the server-derived source allocation and caps one execution to the smaller of the remaining amendment delta and the selected source balance. Expired amendments cannot start new adjustment money movement; if settlement or unresolved provider activity already exists, the decision becomes recovery rather than another execution.

`getHospitalityBookingCommercialAmendmentSettlementState` is an internal, tenant-scoped read boundary. It requires both `booking:manage` and `payment:manage`, reads the amendment and complete payment ledger in one serializable snapshot, and combines lifecycle with settlement truth. `canApply` is false once the prepared amendment is expired or terminal even when external money evidence would otherwise reconcile to the target total.

Generic payment/refund actions do not populate `commercialAmendmentId`. Amendment-owned executors use that attribution and preserve `HospitalityBooking.paymentStatus`, commercial terms, allocation, and `updatedAt` until the final apply transaction.

## Manual settlement execution

`recordManualHospitalityBookingCommercialAmendmentSettlement` is the amendment-owned manual execution boundary. The authenticated booking workspace can reach it only through the tenant-scoped commercial-amendment transport after a reviewed amendment is prepared. Staff must complete the real external money operation first; SF then records the real external reference. The browser never supplies the amount, currency, provider, amendment ownership, or refund source.

The service requires both `booking:manage` and `payment:manage`, tenant-scopes booking and amendment reads, serializes tenant idempotency plus the shared booking mutation lock, and revalidates the confirmed booking, unchanged prepared booking version, original booking money, amendment provider, complete payment ledger, amendment settlement state, and server-derived execution decision before recording anything.

For `ADDITIONAL_CHARGE`, SF records exactly the remaining amendment delta as a real external manual payment reference. For `REFUND`, SF selects the settlement source server-side and records at most that source's remaining refundable balance, allowing a larger amendment refund to progress source by source. The external reference is tenant-unique, the request fingerprint binds amendment/operation/money/source/reference, exact idempotent retries fail closed on any mismatch, and audit history records the amendment-linked payment evidence.

The manual adapter still never pretends to move funds. This service records an external charge/refund that staff has actually completed outside SF. It does not update `HospitalityBooking.paymentStatus`, commercial terms, allocation, or `updatedAt`; only `PaymentTransaction` and audit evidence change before final apply. That preserves the prepared booking-version guard and prevents one payment operation from prematurely rewriting booking truth.

## Stripe refund execution and recovery

`refundStripeHospitalityBookingCommercialAmendment` is the amendment-owned money-moving boundary for the refund direction. The commercial-amendment product transport exposes it only when the server-derived execution decision says the exact next action is a Stripe refund. It requires `booking:manage` and `payment:manage`, resolves the active Stripe integration server-side, serializes tenant idempotency plus booking mutation/payment locks, revalidates the prepared booking version and original money, and derives the exact refund source and amount from the complete payment ledger and amendment execution decision. The caller cannot provide a PaymentIntent, amount, currency, or settlement source.

Before crossing Stripe, SF persists the amendment-attributed refund claim as `AMBIGUOUS`, not generic `PENDING`. This is deliberate isolation: the existing generic Stripe webhook and generic polling boundaries only finalize ordinary pending booking payments/refunds. An amendment-owned provider write must not be mistaken for an ordinary refund and prematurely change `HospitalityBooking.paymentStatus` before the commercial amendment is applied. The ambiguous claim also pins the amendment recovery boundary if the process crashes while external outcome is unknown.

The claim fingerprint binds booking, amendment, exact minor-unit amount, currency, and server-selected Stripe PaymentIntent source. Exact retry re-derives the same authoritative execution plan after excluding its own unresolved claim and reuses the same Stripe idempotency key. A changed source or amount fails closed. Definitive provider failures close only an internal claim as `FAILED`; transport/time-out uncertainty remains `AMBIGUOUS` because external money may exist.

A Stripe `succeeded` refund becomes amendment-attributed `SUCCEEDED`. A non-final Stripe refund remains `AMBIGUOUS` with its real `re_` reference. `reconcileStripeHospitalityBookingCommercialAmendmentRefund` is the dedicated read-only provider-truth recovery boundary for those real refund references. It tenant-scopes organization, booking, amendment, and transaction, requires both management permissions, verifies exact persisted fingerprint/source/money against Stripe, and updates only the amendment-linked payment transaction plus audit evidence. It intentionally does not rewrite booking payment or commercial state.

The authenticated `/stripe-refund/status` transport resolves exactly one unresolved amendment-owned refund. An internal claim is retried with its persisted idempotency identity; a real `re_` reference is reconciled through provider truth. Larger amendment refunds can continue source by source with a fresh idempotency key after each definitive successful refund. Once amendment settlement reaches `READY_TO_APPLY`, the final serializable apply service remains the only boundary allowed to rewrite the booking snapshot.

## Internal Stripe additional-charge execution and recovery

`chargeStripeHospitalityBookingCommercialAmendment` is the amendment-owned Stripe executor for the additional-charge direction. It remains internal and accepts only a Stripe-issued PaymentMethod when a fresh authorization is actually required; SF never accepts raw card data and never reuses a historical settlement credential as authority for a new charge.

The executor requires both management permissions, tenant-scopes amendment/booking/ledger reads, serializes the shared booking/payment and stage-specific idempotency scopes, and revalidates the exact confirmed/paid prepared booking snapshot before crossing Stripe. Amount, currency, settlement state, and capture PaymentIntent are derived server-side. Authorization and capture use separate deterministic stage keys and fingerprints: authorization binds the PaymentMethod, while capture binds the successful Stripe PaymentIntent.

Provider calls are claimed as amendment-attributed `AMBIGUOUS` transactions so generic normal-booking Stripe finalizers cannot mutate `HospitalityBooking.paymentStatus`. Exact internal-claim retries exclude their own unresolved authorization claim when re-deriving settlement, then require the same execution amount and fingerprint before replaying the same Stripe idempotency key. A real unresolved `pi_` reference is not blindly replayed; it is handed to dedicated reconciliation.

A successful manual-capture authorization is persisted as `AUTHORIZATION / SUCCEEDED`, then capture may proceed only while the amendment is still unexpired and only when the authorization amount exactly equals the current remaining adjustment. If Stripe reports the PaymentIntent already `succeeded`, SF creates deterministic matching `CAPTURE / SUCCEEDED` evidence only from provider truth proving the full exact amount was received; settlement de-duplicates that matching authorization/capture reference.

`reconcileStripeHospitalityBookingCommercialAmendmentCharge` polls the exact PaymentIntent for an amendment-owned `AMBIGUOUS` authorization/capture with a real provider reference. It validates provider reference, currency, total amount, received/capturable amount, tenant, booking, and amendment ownership, then updates only payment/audit evidence. It does not rewrite booking state. An expired amendment can therefore reconcile provider truth, but the executor will not start a new capture after expiry.

Signed PaymentIntent/refund callbacks can finalize the same provider-known normal amendment `AMBIGUOUS` evidence. The public Stripe route first runs the existing tenant-secret signature verification and durable event ingestion. `finalizeVerifiedStripeCommercialAmendmentWebhook` then requires that exact verified event ID/type/hash and the exact persisted provider reference, tenant/booking/amendment identity, currency, amount, and refund source/fingerprint where applicable. The callback updates only amendment payment evidence plus `PaymentWebhookEvent`; it never rewrites booking payment/commercial state. It intentionally refuses to guess ownership for a row that still has only an internal `sf_claim_*` reference.

Expired-amendment recovery callbacks use a separate finalizer before normal amendment finalization because compensation reverses the normal direction contract: recovery capture belongs to an expired refund amendment, while compensation refund belongs to an expired additional-charge amendment. `finalizeVerifiedStripeCommercialAmendmentRecoveryWebhook` requires the exact tenant-owned provider reference plus deterministic recovery idempotency key/fingerprint, amendment identity, exact money, and refund source where applicable. Provider-known recovery evidence can therefore converge through either signed callback or dedicated polling without allowing generic payment logic to rewrite `HospitalityBooking.paymentStatus`. Detailed semantics are documented in `docs/stripe-commercial-amendment-webhooks.md` and `docs/commercial-amendment-recovery.md`.

The normal customer-facing Stripe price-increase transport remains intentionally separate. A production browser flow must obtain fresh customer authorization through a Stripe-hosted/Stripe.js boundary and handle required authentication safely; the internal PaymentMethod executor is not itself an exposed payment form or browser authority. Detailed charge semantics are documented in `docs/stripe-commercial-amendment-charges.md`.

## Product orchestration boundary

`hospitality-booking-commercial-amendment-transport-service.ts` is the authenticated orchestration layer above the existing domain services. Every transport read/write requires `booking:manage` and `payment:manage`, scopes resources by organization plus booking plus amendment, and returns only server-derived state.

The booking workspace can prepare a reviewed non-zero change, resume an unexpired prepared amendment, record real manual settlement, execute/reconcile an exact Stripe refund, cancel before adjustment money settles, and invoke final apply only when settlement is `READY_TO_APPLY`. Stripe source references remain server-only; manual refund source references are shown because staff need the exact external source they must refund. Normal Stripe price increases render `STRIPE_CUSTOMER_AUTHORIZATION_REQUIRED` with no dead or fake payment action.

The API surface is documented in `docs/commercial-amendment-orchestration.md`. Browser fields are never authority for organization identity, payment provider, money, settlement source, provider reference, settlement truth, or final apply readiness.

## Final serializable apply

`applyHospitalityBookingCommercialAmendment` remains the only service allowed to commit a paid prepared amendment. The authenticated `/apply` transport route invokes it only after server state reports readiness; the service independently revalidates all authority and therefore does not trust the browser's readiness signal.

It requires both `booking:manage` and `payment:manage`, serializes on the shared booking mutation lock plus stable current/target allocation locks, and never trusts browser-supplied money, settlement, provider, inventory, or tenant authority.

Before mutation it requires an unexpired `PREPARED` amendment and revalidates the tenant-owned confirmed booking, exact current allocation and stay dates, immutable booking version/current terms/current price, normalized add-ons, target room/rate assignment, traveler occupancy, stay restrictions, target selection fingerprint, protection quantity, authoritative transactional target price, adjustment fingerprint, and amendment-attributed payment settlement. Price drift is rejected as a fresh-price conflict rather than silently applying stale reviewed money.

When target protection is required, apply also requires the exact active hold created for this amendment: tenant, hold ID, deterministic hold idempotency identity, property, room type, rate plan, stay dates, protected quantity, and expiry must all still match. An expired or mismatched hold fails closed. The service does not auto-expire an amendment after external settlement could exist; that state requires recovery or compensation rather than deleting evidence.

Only `READY_TO_APPLY` settlement may cross the mutation boundary. In one serializable transaction SF replaces booking room/rate/quantity/add-ons and all authoritative price components, updates the booking allocation, restores the denormalized booking payment status to `PAID` because net settlement now equals the amended total, releases the target hold, marks the amendment `APPLIED`, and writes booking plus amendment audit history. Replaying an already `APPLIED` amendment is idempotent and does not mutate booking state again.

Any online amendment settlement executor must persist its money evidence in `PaymentTransaction` without rewriting the booking's commercial/payment snapshot before final apply. The prepared `bookingVersion` is intentionally part of the apply guard; provider execution must not invalidate its own reviewed commercial snapshot by touching `HospitalityBooking.updatedAt` early.

## Database invariants

The amendment schema enforces tenant-safe foreign keys, positive quantities, non-negative monetary components, exact totals, delta/direction agreement, hold/protection consistency, and terminal lifecycle timestamps. Refund-source attribution is constrained to refund rows and indexed by tenant/provider/source reference. Amendment-linked payment rows additionally have a tenant-and-booking-scoped foreign key back to the exact commercial amendment and a tenant/amendment/creation-time index for recovery reads.

The browser cannot supply organization ownership, current booking money, provider authority, net settlement authority, refund-source authority, amendment-payment authority, or inventory authority.

## Still intentionally closed

The Phase 13 general commercial modification item remains open. The real booking workspace now covers reviewed preparation, manual settlement, Stripe refund execution/reconciliation, guarded cancellation, recovery handoff, and final serializable apply. The remaining normal online payment dependency is fresh customer-authorized Stripe collection for an `ADDITIONAL_CHARGE`; SF must not reuse historical card credentials or expose the internal PaymentMethod executor as if a prepared delta were payment consent.

Explicit expired-hold/payment recovery exists for manual compensation and for Stripe authorization release, compensation capture, adjustment-source compensation refund, polling reconciliation, signed provider-known recovery callbacks, and customer-authorized recovery Checkout where compensation requires a fresh charge. Existing generic `PENDING` finalizers intentionally do not claim amendment ownership, and signed amendment callbacks deliberately do not bind internal pre-reference `sf_claim_*` rows without exact local provider identity; those remain exact-retry/polling/operator recovery cases.

The current 15-minute protection window is intentionally not extended merely because settlement started. Amendment-attributed payment evidence pins an expired amendment into recovery: competing booking/payment mutations, automatic expiry, and explicit cancellation fail closed until reconciliation proves definitive failure or compensation resolves the money state. A normal Stripe customer-authorized payment transport must therefore define its hold-expiry/late-payment behavior coherently rather than reusing recovery Checkout by convenience.

## Validation

Dependency-free amendment/payment-domain tests cover room-type changes, same-room quantity changes, bounded expiry, deterministic hold identity, malformed fingerprints, refund-to-source attribution, source balances, legacy single-source inference, legacy multi-source fail-closed behavior, source-level over-refunds, deterministic next-source allocation, source-scoped execution planning, input-order independence, stable tie-breaking, exact bigint money, net-settlement refund availability, sequential manual/Stripe multi-source refunds, amendment-attributed additional settlement/refund progression, authorization-versus-capture semantics, partial source-split adjustment refunds, settlement drift, over-settlement, unresolved-operation conflicts, provider-neutral amendment execution decisions, expired-before-money versus recovery-required lifecycle decisions, final-apply consistency checks for booking version/current terms/current price, target selection, inventory protection, target price, adjustment identity, expiry-guard behavior, Stripe amendment-refund claim/reconciliation exactness, Stripe amendment-charge stage identity/reconciliation exactness, exact signed amendment-webhook provider-reference/source matching, deterministic expired-recovery callback identity/source enforcement, and commercial-amendment transport-state mapping.

The focused commercial-amendment transport-state suite passes 5/5 under the available runtime. The new transport domain/service/routes and booking workspace components pass the available TypeScript syntax parser. Existing focused Stripe amendment suites remain relevant, including charge, normal webhook candidate, and recovery-webhook identity coverage.

Full repository typecheck/lint/build, Prisma validation/migration execution, and PostgreSQL integration tests still require the repository Node 24 toolchain and a confirmed disposable PostgreSQL target. The manual/Stripe amendment executors, product transport routes, normal/recovery signed callback finalizers, verified-event promotion/locking, polling-webhook concurrency, recovery terminalization, and final apply service therefore remain subject to that database-backed validation gate before Phase 13 can be considered complete.
