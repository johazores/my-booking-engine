# Commercial amendment expiry recovery

Commercial amendment expiry is not permission to discard provider money. A `PREPARED` hospitality commercial amendment that reaches its expiry time remains blocking whenever amendment-owned payment evidence shows unresolved or successful external activity. Recovery must restore authoritative booking settlement to the immutable pre-amendment total before the amendment can become terminal and release its target inventory protection.

A fully settled amendment can also enter this same recovery lifecycle immediately when final booking application fails with a known booking, pricing, or inventory conflict. That routing is allowed only after a fresh tenant-scoped ledger read proves the amendment is `READY_TO_APPLY`; unresolved or conflicting payment evidence cannot be converted into compensation authority. The failed apply transaction is rolled back first, then a separate serializable transaction shortens the still-`PREPARED` amendment expiry, releases remaining target protection, and records audit evidence without mutating booking or provider truth.

## Recovery authority

`deriveHospitalityCommercialAmendmentRecoveryDecision` is the provider-neutral recovery authority. It consumes the immutable before/after amendment snapshot plus the complete tenant-owned booking payment ledger and returns one of these states:

- `NOT_EXPIRED` — the normal amendment lifecycle still owns the operation.
- `WAIT_FOR_PROVIDER` — amendment-owned `PENDING` or `AMBIGUOUS` evidence must be reconciled before compensation can be chosen.
- `RELEASE_AUTHORIZATION` — an expired Stripe amendment still has an uncaptured authorization that must be released.
- `CAPTURE_COMPENSATION` — refund recovery has an exact Stripe compensation authorization that must be captured or reconciled rather than replaced.
- `COMPENSATE` — authoritative net settlement is within the prepared before/after boundary but not back at the original total. The server decides exact direction, provider, amount, and refund source where applicable.
- `READY_TO_EXPIRE` — authoritative net settlement exactly equals the original booking total and no provider work is unresolved.
- `TERMINAL` or `CONFLICT` — no new recovery money movement may start.

The domain fails closed on tenant/provider/currency drift, successful post-prepare money outside the amendment, unrelated unresolved payment activity, missing refund-source attribution, multiple uncaptured authorizations, unexplained net settlement, or money outside the immutable before/after range.

For expired additional-charge amendments, only settlement sources created by that exact amendment can fund compensation refunds. For expired refund amendments, restoring money requires a real compensation charge; Stripe compensation charges require fresh customer authority.

## Manual recovery

`recordManualHospitalityBookingCommercialAmendmentRecovery` records real manual compensation events that already happened outside SF. It requires both `booking:manage` and `payment:manage`, tenant-scopes booking/amendment/payment history, serializes booking and idempotency writes, revalidates the prepared booking snapshot, and derives exact money/refund source server-side. The caller supplies only the bounded idempotency key and real external manual reference.

Manual recovery writes amendment-owned payment and audit evidence only. It never changes booking commercial terms or `HospitalityBooking.paymentStatus`. When authoritative settlement returns to the original total, the shared finalizer releases target protection and marks the amendment `EXPIRED` atomically.

## Stripe provider recovery

`executeStripeHospitalityBookingCommercialAmendmentRecovery` handles provider work that does not require inventing new customer authority. It supports uncaptured authorization release, exact compensation capture, and compensation refund from an adjustment-created source. Provider-specific behavior remains behind the Stripe adapter.

Every recovery operation is tenant/amendment scoped, uses deterministic operation identity and request fingerprints, and preserves the booking snapshot. Retryable or non-final provider truth remains unresolved; definitive failures become failed evidence; exact successful provider truth becomes successful amendment-owned evidence. Generic booking payment finalizers do not own these rows and cannot mutate booking payment/commercial state from them.

`reconcileStripeHospitalityBookingCommercialAmendmentRecovery` polls real provider references for ambiguous recovery captures/refunds. It verifies exact provider identity, money, refund source, persisted fingerprint, booking, amendment, and tenant before persistence changes.

## Customer-authorized Stripe recovery Checkout

An expired `REFUND` amendment can have already moved money out before failing to apply, leaving booking settlement below the immutable original total. `createStripeHospitalityBookingCommercialAmendmentRecoveryCheckout` supplies the customer-authorized compensation-charge boundary for that case.

The service requires both management permissions, verifies the exact expired refund recovery decision, derives compensation money server-side, creates an amendment-owned `CAPTURE / AMBIGUOUS` claim before contacting Stripe, and allows only one unresolved recovery Checkout claim at a time. Stripe Checkout Session and PaymentIntent metadata carry organization, booking, amendment, purpose, and exact money as consistency evidence.

`reconcileStripeHospitalityBookingCommercialAmendmentRecoveryCheckout` retrieves the exact Checkout Session through the Stripe adapter. Exact paid Session truth promotes the amendment claim to the returned PaymentIntent; exact expired/unpaid truth without a PaymentIntent becomes definitively failed; non-final truth stays ambiguous. Provider identity, tenant, amendment, purpose, amount, and currency drift fail closed.

Signed Stripe callbacks give recovery-owned Checkout and provider recovery operations first chance to consume verified events before normal amendment/payment finalizers. A browser redirect is never treated as settlement authority.

## Authenticated product transport

The booking workspace exposes expired amendment recovery through a dedicated authenticated transport instead of requiring an internal-only service caller.

`findHospitalityBookingCommercialAmendmentRecoveryTransport` discovers at most one expired `PREPARED` amendment for the exact `organizationId + bookingId`. It requires both `booking:manage` and `payment:manage`. Multiple expired prepared amendments fail closed for operator reconciliation.

The transport maps the provider-neutral recovery decision into safe product states:

- `CHECKOUT_REQUIRED` — an exact Stripe compensation charge needs customer Checkout.
- `CHECKOUT_RESUME_REQUIRED` — a prior retryable provider call left the deterministic internal Checkout claim unresolved and must resume the same attempt identity.
- `CHECKOUT_PENDING` — a real persisted `cs_*` Session exists. Staff may poll provider truth or resume that same Stripe Session through the same deterministic idempotent attempt; SF does not create a second charge attempt while it remains non-final.
- `READY_TO_CLOSE` — settlement is restored and the shared recovery finalizer can close the amendment.
- `RECOVERED` — recovery is already terminal as `EXPIRED`.
- `WAIT_FOR_PROVIDER`, `RECOVERY_REQUIRED`, `NOT_EXPIRED`, `TERMINAL`, or `CONFLICT` — no browser-invented money action is allowed.

The staff Checkout attempt key is deterministic from the count of definitively failed attempts. Retryable provider failure therefore resumes the same request identity; a definitively failed or expired Checkout advances to the next bounded attempt only after provider truth is reconciled. The browser never supplies payment amount, currency, provider/source reference, Checkout Session ID, financial idempotency identity, or arbitrary return URL.

### Start or resume Checkout

`POST /api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/recovery/stripe-checkout`

The route requires authenticated same-origin writes and an active organization. It constructs Stripe success/cancel URLs server-side from the exact booking/amendment route and current application origin, then calls the tenant-scoped recovery transport. It never accepts client-provided financial authority. If a live `cs_*` Session already exists, the same deterministic provider request can return that Session again so a customer who backed out can resume without creating a new payment attempt.

### Reconcile Checkout

`POST /api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/recovery/stripe-checkout/status`

The browser does not submit a Session ID. The server finds at most one unresolved amendment-owned recovery Checkout claim. An internal claim is classified as resumable; an exact `cs_*` reference is polled through the Stripe adapter; another unresolved provider reference remains `WAIT_FOR_PROVIDER`; multiple candidates fail closed. When net settlement returns to the original booking total, the existing recovery finalizer releases target inventory protection and marks the amendment `EXPIRED`.

### Booking UI behavior

The booking detail route is wrapped by a recovery panel only when the authenticated staff member can manage both bookings and payments and an expired prepared amendment exists for that tenant-owned booking. The panel shows only server-derived recovery state, reason, provider/operation, and formatted amount.

A primary customer Checkout action appears only for `CHECKOUT_REQUIRED`, `CHECKOUT_RESUME_REQUIRED`, or a still-live `CHECKOUT_PENDING` Session that can resume the same attempt. Provider-status/finalization actions appear only when the transport allows them. Provider-side recovery such as authorization release, compensation capture, compensation refund, or conflict resolution is never presented as a fake browser action.

Stripe success and cancel returns carry only an amendment/UI resume marker. Both trigger authoritative reconciliation. Cancel is explicitly not treated as proof that no payment occurred, preventing a second charge while provider truth may still be in flight. The client reads the return marker after hydration rather than making the server layout depend on mutable search parameters. Loading, error, provider-waiting, resume, retry, and recovered states remain distinct.

## HTTP error boundary

The booking HTTP boundary maps payment-domain failures explicitly for these booking-owned payment routes: payment conflicts return `409`, payment unavailability returns `404`, retryable provider errors return `503`, and non-retryable provider errors return `502`. Responses remain `no-store`; payment failures do not collapse into a generic booking `500` solely because the route is under the booking namespace.

## Post-settlement apply failure routing

`routeSettledHospitalityBookingCommercialAmendmentApplyFailureToRecovery` is the durable bridge between a failed final apply and the existing expired-amendment compensation lifecycle. It requires both management permissions, takes the booking mutation advisory lock, scopes the amendment and complete payment ledger by organization plus booking, and re-derives amendment settlement inside a serializable transaction.

Only `READY_TO_APPLY` settlement can be routed. The service never converts `REQUIRES_EXECUTION`, `IN_PROGRESS`, or `CONFLICT` into compensation authority. For eligible settled failures it preserves `PREPARED`, never extends expiry, releases any remaining tenant-owned target hold, and records `booking.commercial-amendment.recovery-required` audit evidence. Existing expired-amendment guards therefore continue blocking unrelated booking/payment mutation while recovery owns the money.

The normal apply transport invokes this routing only for known booking conflict, price-change, or booking-unavailable domain failures after the original apply transaction has rolled back. Arbitrary infrastructure exceptions are not reclassified as commercial recovery events.

## Remaining Phase 13 boundary

Reviewed price changes now connect through durable amendment preparation, manual/Stripe settlement, customer-authorized Stripe Checkout, signed/polling reconciliation, final serializable apply, explicit expiry recovery, and immediate recovery routing when fully settled money cannot be applied safely.

Phase 13 still requires the repository's remaining production checklist work and environment-backed verification before it can be marked complete. In particular, PostgreSQL concurrency/migration validation, full Node 24 repository validation, real-provider operational checks, and any still-open invoice/tax or release requirements in GitHub issue #1 remain authoritative. Do not infer completion from dependency-free domain coverage alone.

## Validation expectations

Dependency-free tests cover recovery decisions, Stripe recovery operation identity, recovery webhook ownership, Checkout reconciliation, product transport state/attempt-key mapping, and post-settlement apply-failure routing. Database validation remains required for advisory-lock ordering, tenant predicates, idempotency races, provider persistence, signed webhook/polling concurrency, target-hold release, apply-failure recovery routing, amendment terminalization, and payment/audit persistence. Do not claim those PostgreSQL paths passed unless the guarded disposable database suite runs against an explicitly confirmed disposable target.
