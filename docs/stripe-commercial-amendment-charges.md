# Stripe commercial amendment additional charges

SF has an internal Stripe additional-charge executor for prepared hospitality commercial amendments. It is infrastructure for production settlement/recovery and is intentionally not exposed as a browser API or primary UI action yet.

## Authority and scope

`chargeStripeHospitalityBookingCommercialAmendment` requires both `booking:manage` and `payment:manage`. The service accepts organization, actor, booking, amendment, a stable request idempotency key, and—only when a fresh authorization is actually required—a Stripe-issued PaymentMethod reference. SF never accepts raw card data.

Before any provider call the service serializes the tenant booking mutation/payment scopes, resolves the amendment by `(organizationId, bookingId, amendmentId)`, proves it is a Stripe `ADDITIONAL_CHARGE`, verifies the booking is still the exact confirmed/paid snapshot that was prepared, and re-derives the complete booking/amendment settlement ledger. Browser input never supplies the amount, currency, capture reference, or settlement state.

The provider-issued PaymentMethod is authority only for the new Stripe authorization request. SF does not reuse a historical settlement credential or PaymentIntent to create a new charge.

## Authorization and capture lifecycle

A fresh additional charge is split into explicit Stripe authorization and capture stages.

- Each stage receives a deterministic tenant-safe internal idempotency key derived from the caller's stable root request key, booking, amendment, and stage.
- Authorization fingerprints bind booking, amendment, exact server-derived money, and the Stripe PaymentMethod reference.
- Capture fingerprints bind booking, amendment, exact money, and the successful Stripe PaymentIntent reference.
- Provider calls are claimed as amendment-attributed `PaymentTransaction` rows before external I/O.
- Claims use `AMBIGUOUS`, not generic `PENDING`, so the existing normal-booking payment webhook/reconciliation paths cannot mutate `HospitalityBooking.paymentStatus` while an amendment is still only prepared.
- Definitive provider failures become `FAILED`; retryable/uncertain outcomes remain recoverable.
- A successful manual-capture authorization is persisted as `AUTHORIZATION / SUCCEEDED`, then the executor advances to capture while the amendment is still unexpired.
- A successful capture is persisted as `CAPTURE / SUCCEEDED` with the same PaymentIntent reference.

If Stripe reports an authorization as already `succeeded` rather than `requires_capture`, SF records both the successful authorization and deterministic successful capture evidence for that same PaymentIntent. This is not invented payment: the capture ledger row is created only from provider truth proving the full exact amount was already received. Settlement reconciliation de-duplicates the matching authorization/capture reference.

A successful standalone authorization is capturable only when it exactly equals the amendment's current remaining adjustment. If earlier linked settlement changed that remaining amount, capture fails closed instead of overcharging.

## Expiry and recovery

Expiry remains authoritative. The executor re-evaluates amendment lifecycle before capture. If the amendment expires after authorization, SF does not start a new capture merely because authorization exists; the amendment enters the existing recovery-required boundary.

An `AMBIGUOUS` transaction with a real PaymentIntent reference is never replayed blindly. `reconcileStripeHospitalityBookingCommercialAmendmentCharge` retrieves Stripe provider truth and updates only the amendment-owned payment evidence. It works for both authorization and capture and validates PaymentIntent identity, currency, exact amount, received/capturable money, tenant ownership, booking ownership, and amendment ownership.

If the local claim still has only an internal `sf_claim_*` reference, polling cannot prove provider truth. The exact idempotent operation must be retried while lifecycle still permits new money movement; once the amendment has expired, that uncertainty requires operator recovery rather than a potentially new external charge.

Reconciliation deliberately does not change booking payment/commercial state. A directly settled authorization recovered by polling creates the same deterministic capture evidence described above. Final booking mutation remains exclusively owned by `applyHospitalityBookingCommercialAmendment` after provider-neutral settlement reaches `READY_TO_APPLY` and all pricing, inventory, booking-version, and target-hold checks still pass.

## What remains closed

This executor consumes a Stripe-issued PaymentMethod but does not itself provide the customer-facing collection transport. A production browser flow still needs a Stripe-hosted/Stripe.js collection boundary with required customer authentication, safe return/recovery handling, and no exposure of internal amendment authority.

Signed Stripe webhook finalization for amendment-owned `AMBIGUOUS` authorization/capture/refund rows is also still open. Existing generic Stripe callback handlers intentionally do not consume these rows. Explicit compensation and target-inventory recovery for provider money that settles after amendment expiry or after a final-apply conflict must be completed before any amendment settlement/apply action is exposed to staff or customers.

## Validation

The dependency-free `booking-commercial-amendment-stripe-charge-domain.test.ts` suite covers deterministic stage idempotency, payment-method/PaymentIntent fingerprint separation, provider-state normalization, exact authorization/capture reconciliation, direct-settlement evidence identity, and provider/money drift rejection.

The available automation runtime can execute that pure-domain suite and TypeScript syntax parsing. Full repository typecheck/lint/build, Prisma generation/validation, migration checks, and database-backed locking/idempotency validation still require the repository's Node 24 environment and an explicitly confirmed disposable PostgreSQL target. GitHub Actions are not used.
