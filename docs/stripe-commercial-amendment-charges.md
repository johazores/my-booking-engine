# Stripe commercial amendment additional charges

SF supports two production-safe Stripe additional-charge boundaries for prepared hospitality commercial amendments:

- the internal authorization/capture executor for server-owned PaymentMethod workflows; and
- customer-authorized Stripe-hosted Checkout for the normal booking-workspace price-increase journey.

Both boundaries are amendment-owned. Neither can change booking commercial terms or `HospitalityBooking.paymentStatus` before the existing final amendment apply service proves settlement and revalidates inventory/pricing state.

## Authority and scope

All authenticated amendment settlement boundaries require both `booking:manage` and `payment:manage` and resolve the amendment by `(organizationId, bookingId, amendmentId)`. The server verifies the exact confirmed/paid booking snapshot that was prepared and re-derives the complete tenant-owned payment ledger before authorizing provider work.

The browser never supplies organization identity, payment provider, currency, amount, PaymentIntent source, settlement state, or apply authority. SF never accepts raw card data.

The internal executor accepts a Stripe-issued PaymentMethod reference only when fresh authorization is actually required. The hosted Checkout flow does not accept a PaymentMethod from the browser at all; the customer enters payment details only on Stripe.

## Customer-authorized hosted Checkout

A prepared Stripe `ADDITIONAL_CHARGE` that reaches `STRIPE_CUSTOMER_AUTHORIZATION_REQUIRED` can now start or resume:

`POST /api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/stripe-checkout`

The route uses the authenticated same-origin booking context. Success/cancel URLs are created on the server and return to the booking workspace; redirects are navigation only and never establish payment truth.

`hospitality-booking-commercial-amendment-stripe-checkout-service.ts` creates an amendment-attributed `CAPTURE / AMBIGUOUS` claim before provider I/O. The request identity is deterministic and tenant-bound to organization, booking, amendment, and the server-derived attempt number. The fingerprint binds booking, amendment, exact currency, and exact remaining adjustment money.

Only one unresolved provider operation may exist for the amendment. Definitive failed Checkout attempts allow a fresh deterministic attempt. An unresolved internal claim or bound Checkout Session resumes the same attempt instead of starting another charge.

Stripe Checkout receives explicit Session and PaymentIntent metadata:

- `sf_organization_id`
- `sf_booking_id`
- `sf_commercial_amendment_id`
- `sf_checkout_purpose=commercial-amendment-charge`

The adapter validates the returned `cs_*` reference, hosted HTTPS URL, expiry, currency, and amount before the Session is bound to the persisted claim. Provider configuration remains behind the Stripe integration adapter.

## Checkout reconciliation and signed callbacks

`POST .../[amendment-id]/stripe-checkout/status` retrieves the exact persisted Checkout Session from Stripe. Reconciliation validates Session identity, tenant, booking, amendment, purpose, exact currency/amount, and PaymentIntent identity before changing amendment-owned payment evidence.

A complete/paid Session becomes `CAPTURE / SUCCEEDED` and replaces the local `cs_*` reference with the real `pi_*` reference. An expired/unpaid Session with no PaymentIntent becomes a definitive `FAILED` attempt. Other provider states remain `AMBIGUOUS`; SF does not guess success.

Signed Stripe Checkout callbacks use the same ownership contract. After tenant-specific signature verification and durable webhook ingestion, `finalizeVerifiedStripeCommercialAmendmentCheckoutWebhook` handles only `commercial-amendment-charge` Checkout events and requires the exact verified event identity/hash plus exact persisted amendment claim, Session reference, money, and ownership metadata. It updates only the amendment payment transaction and webhook event ledger.

Normal commercial Checkout finalization runs before generic booking-payment webhook finalization, so amendment-owned customer payments cannot accidentally mutate the booking through normal payment-state logic.

## Authorization and capture lifecycle

The internal additional-charge executor remains available for trusted server-owned PaymentMethod workflows. Fresh charges are split into explicit Stripe authorization and capture stages.

- Each stage receives a deterministic tenant-safe internal idempotency key derived from the caller's stable root request key, booking, amendment, and stage.
- Authorization fingerprints bind booking, amendment, exact server-derived money, and the Stripe PaymentMethod reference.
- Capture fingerprints bind booking, amendment, exact money, and the successful Stripe PaymentIntent reference.
- Provider calls are claimed as amendment-attributed `PaymentTransaction` rows before external I/O.
- Claims use `AMBIGUOUS`, not generic `PENDING`, so normal-booking payment webhook/reconciliation paths cannot mutate `HospitalityBooking.paymentStatus` while an amendment is only prepared.
- Definitive provider failures become `FAILED`; retryable/uncertain outcomes remain recoverable.
- A successful manual-capture authorization is persisted as `AUTHORIZATION / SUCCEEDED`, then the executor advances to capture while lifecycle permits it.
- A successful capture is persisted as `CAPTURE / SUCCEEDED` with the same PaymentIntent reference.

If Stripe reports an authorization as already `succeeded` rather than `requires_capture`, SF records deterministic successful settlement evidence only from that provider truth. Settlement reconciliation de-duplicates matching authorization/capture references.

## Expiry and recovery

The commercial amendment/target-inventory window is still authoritative for **applying booking terms**. Stripe Checkout may remain open longer than that prepared window. SF therefore treats a late payment as real money but never as permission to apply stale terms.

If the amendment expires while Checkout/provider state is unresolved, the amendment remains recovery-blocking. Polling or signed callbacks may still resolve the exact provider result. A late successful additional charge becomes amendment-owned `SUCCEEDED` evidence, after which the existing expired-amendment recovery domain derives the exact compensating refund from the adjustment-created settlement source. The stale booking change is not applied.

If Checkout expires unpaid with no provider payment evidence, the claim becomes `FAILED`; normal expiry can then release target protection once no other recovery-blocking payment activity remains.

For the internal authorization/capture executor, an authorization that outlives the amendment enters the existing release/capture recovery logic rather than being captured merely because it exists.

An `AMBIGUOUS` transaction with a real provider reference is never replayed blindly. Polling and signed callbacks validate exact provider identity and money. Internal `sf_claim_*` references are never treated as provider truth; exact idempotent retry is required while lifecycle permits it, otherwise operator/recovery handling owns the uncertainty.

## Final apply

Provider settlement deliberately does not rewrite the booking. After an unexpired amendment reaches `READY_TO_APPLY`, only `applyHospitalityBookingCommercialAmendment` can commit the change. It revalidates booking version, current/target commercial terms, target hold, target inventory, restrictions, current transactional pricing, adjustment identity, and the complete amendment ledger inside the serializable booking/inventory transaction.

If those checks cannot pass after money settled, the amendment does not force stale terms into the booking; recovery/compensation remains the safe path.

## Validation

Dependency-free coverage now includes the direct authorization/capture domain, normal commercial Checkout deterministic identity/fingerprint/reconciliation, Checkout ownership metadata, Checkout webhook parsing, amendment Stripe refund/recovery domains, and provider-drift rejection.

Full repository typecheck/lint/test/build, Prisma generation/validation/migration checks, and PostgreSQL locking/idempotency/webhook concurrency validation remain mandatory before production release and must run in the repository-required Node 24 environment with an explicitly disposable PostgreSQL target. GitHub Actions are not used.
