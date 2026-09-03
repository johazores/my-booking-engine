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

For an expired additional-charge amendment, only settlement sources created by that amendment are eligible for compensating refunds. SF does not refund an arbitrary older booking payment just because it has a larger balance. For an expired refund amendment, compensation restores the original booking net settlement with a new charge; Stripe customer payment authority is still required before that online compensation can be executed.

## Manual recovery execution

`recordManualHospitalityBookingCommercialAmendmentRecovery` is an internal provider executor for real manual compensation events that already happened outside SF. It has no browser route or primary UI action.

The service requires both `booking:manage` and `payment:manage`, tenant-scopes the booking/amendment/ledger, serializes the tenant idempotency key plus shared booking mutation lock, verifies the booking is still the prepared confirmed/paid snapshot, and re-derives the recovery decision under a serializable transaction. Compensation amount and refund source are server-derived; the caller supplies only a bounded idempotency key and the real external manual reference.

Manual compensation payments/refunds remain linked through `commercialAmendmentId`, use recovery-specific request fingerprints, reject organization-level duplicate provider references, and write audit evidence. The manual adapter still does not move funds. A successful compensation operation never changes booking commercial terms or `HospitalityBooking.paymentStatus`.

When the post-write recovery decision becomes `READY_TO_EXPIRE`, the same transaction releases or expires the target hold, marks the amendment `EXPIRED`, and records `booking.commercial-amendment.recovery-completed`. `finalizeHospitalityBookingCommercialAmendmentRecovery` provides the same terminalization boundary for recovery completed through another provider path. Idempotent retries of an already-recorded manual compensation remain safe after the amendment becomes terminal.

## Stripe boundary still closed

The recovery decision now distinguishes the exact Stripe work that remains, but user-facing settlement/apply stays closed until provider execution is complete:

- release/cancel an expired uncaptured adjustment PaymentIntent with durable retry/reconciliation evidence;
- refund settled additional-charge adjustment sources using the same source-aware Stripe refund invariants;
- collect refund-compensation money only with explicit customer payment authority, then capture/reconcile it amendment-safely;
- converge each operation through polling and signed webhook evidence without allowing generic payment finalizers to mutate the booking before recovery closes.

Until those Stripe recovery executors exist, `RELEASE_AUTHORIZATION`, `CAPTURE_COMPENSATION`, and Stripe `COMPENSATE` states are operator/recovery blockers, not permission to expose a browser action.

## Validation

The dependency-free recovery-domain suite covers no-money expiry, unresolved provider evidence, full and partial additional-charge compensation, refund compensation, restored-net terminalization, Stripe uncaptured authorization handling, exact compensation-authorization matching, post-prepare unrelated successful money, prepared price-bound violations, unexpired lifecycle isolation, and terminal amendments.

Database validation remains required for advisory-lock ordering, tenant predicates, manual idempotency, target-hold release, amendment terminalization, and payment/audit persistence. Do not claim those PostgreSQL paths passed unless the guarded disposable database suite runs against an explicitly confirmed disposable target.
