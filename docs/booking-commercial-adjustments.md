# Commercial booking adjustments

SF has an authenticated, tenant-scoped price-impact review contract, a durable internal amendment boundary for non-zero commercial booking changes, amendment-attributed settlement/reconciliation, and an internal final serializable apply boundary. Provider execution remains deliberately closed until expiry, ambiguity, recovery, and compensation semantics are complete.

## Price review

`POST /api/bookings/hospitality/[booking-id]/modify/preview` accepts normalized room type, rate plan, room quantity, add-on selections, and a booking idempotency key. Organization and actor authority come from the authenticated request context and require `booking:manage`.

The server re-reads the tenant-owned confirmed booking, validates active room/rate assignment and traveler occupancy, recalculates transactional pricing, and compares immutable current money with the proposed quote using integer minor units only. It returns current/proposed components, signed delta, booking version, selection fingerprint, and deterministic adjustment fingerprint.

`ADDITIONAL_CHARGE` and `REFUND` are price-delta directions only. They are not browser authority to charge or refund money.

## Durable amendment preparation

`prepareHospitalityBookingCommercialAmendment` is an internal service boundary and is not exposed as a route or primary UI action until provider execution and recovery are complete.

Preparation requires `booking:manage` and `payment:manage`, serializes on shared booking/inventory advisory locks, and accepts the reviewed adjustment fingerprint rather than browser-supplied price or settlement authority. It revalidates the tenant-owned booking, current allocation, room/rate assignment, occupancy, restrictions, add-ons, transactional pricing, payment settlement, and target inventory before persisting immutable before/after commercial snapshots.

A prepared amendment uses the normal availability-hold core only for inventory that would otherwise be lost while payment is arranged: the full target quantity for a room-type change or incremental units for a same-room quantity increase. Its lifetime is bounded to 15 minutes. Rate/add-on-only changes and quantity decreases do not create artificial holds but retain the same bounded review lifetime.

## Concurrent mutation boundary

A non-expired `PREPARED` amendment is an exclusive commercial-change window. Cancellation, rescheduling, traveler changes, zero-delta commercial mutations, refund availability, and refund writes fail closed while it is active. Payment write boundaries use the same booking mutation lock so settlement cannot change underneath the prepared snapshot.

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

`getHospitalityBookingCommercialAmendmentSettlementState` is an internal, tenant-scoped read boundary. It requires both `booking:manage` and `payment:manage`, reads the amendment and complete payment ledger in one serializable snapshot, and combines lifecycle with settlement truth. `canApply` is false once the prepared amendment is expired or terminal even when external money evidence would otherwise reconcile to the target total.

The attribution column is intentionally not populated by existing generic refund/payment actions. Only an amendment-owned provider executor may create amendment-linked transactions, after that executor also owns expiry/hold recovery and compensation semantics. This avoids accidentally moving money after target inventory protection has expired.

## Final serializable apply

`applyHospitalityBookingCommercialAmendment` is an internal service boundary. It requires both `booking:manage` and `payment:manage`, serializes on the shared booking mutation lock plus stable current/target allocation locks, and never trusts browser-supplied money, settlement, provider, inventory, or tenant authority.

Before mutation it requires an unexpired `PREPARED` amendment and revalidates the tenant-owned confirmed booking, exact current allocation and stay dates, immutable booking version/current terms/current price, normalized add-ons, target room/rate assignment, traveler occupancy, stay restrictions, target selection fingerprint, protection quantity, authoritative transactional target price, adjustment fingerprint, and amendment-attributed payment settlement. Price drift is rejected as a fresh-price conflict rather than silently applying stale reviewed money.

When target protection is required, apply also requires the exact active hold created for this amendment: tenant, hold ID, deterministic hold idempotency identity, property, room type, rate plan, stay dates, protected quantity, and expiry must all still match. An expired or mismatched hold fails closed. The service does not auto-expire an amendment after external settlement could exist; that state requires recovery or compensation rather than deleting evidence.

Only `READY_TO_APPLY` settlement may cross the mutation boundary. In one serializable transaction SF replaces booking room/rate/quantity/add-ons and all authoritative price components, updates the booking allocation, restores the denormalized booking payment status to `PAID` because net settlement now equals the amended total, releases the target hold, marks the amendment `APPLIED`, and writes booking plus amendment audit history. Replaying an already `APPLIED` amendment is idempotent and does not mutate booking state again.

The future amendment settlement executor must persist its money evidence in `PaymentTransaction` without rewriting the booking's commercial/payment snapshot before final apply. The prepared `bookingVersion` is intentionally part of the apply guard; provider execution must not invalidate its own reviewed commercial snapshot by touching `HospitalityBooking.updatedAt` early.

## Database invariants

The amendment schema enforces tenant-safe foreign keys, positive quantities, non-negative monetary components, exact totals, delta/direction agreement, hold/protection consistency, and terminal lifecycle timestamps. Refund-source attribution is constrained to refund rows and indexed by tenant/provider/source reference. Amendment-linked payment rows additionally have a tenant-and-booking-scoped foreign key back to the exact commercial amendment and a tenant/amendment/creation-time index for recovery reads.

The browser cannot supply organization ownership, current booking money, provider authority, net settlement authority, refund-source authority, amendment-payment authority, or inventory authority.

## Still intentionally closed

Preparing an amendment does not charge, refund, apply inventory changes, or rewrite booking/payment state. The internal final apply service is deliberately not exposed as a route or primary UI action while no safe amendment-owned provider executor exists. The Phase 13 general commercial modification item remains open.

The next dependency is the amendment-owned provider executor/recovery lifecycle. For an additional-charge amendment, SF still needs a durable provider operation that can survive retry/ambiguity and prove the new net settlement. For a refund-direction amendment, the source-aware refund infrastructure provides source allocation and recovery primitives, but the amendment lifecycle must own when each refund is initiated, how each provider operation receives `commercialAmendmentId`, and how expiry/cancellation/compensation behaves after external money movement.

The current 15-minute protection window is intentionally not extended merely because settlement started. The executor must solve target-inventory hold recovery and crash/ambiguity compensation coherently before any user-facing action can move amendment money. Once settlement reaches `READY_TO_APPLY` while protection and booking version are still valid, the internal final apply boundary is available to complete the commercial state transition atomically.

## Validation

Dependency-free amendment/payment-domain tests cover room-type changes, same-room quantity changes, bounded expiry, deterministic hold identity, malformed fingerprints, refund-to-source attribution, source balances, legacy single-source inference, legacy multi-source fail-closed behavior, source-level over-refunds, deterministic next-source allocation, source-scoped execution planning, input-order independence, stable tie-breaking, exact bigint money, net-settlement refund availability, sequential manual/Stripe multi-source refunds, amendment-attributed additional settlement/refund progression, authorization-versus-capture semantics, partial source-split adjustment refunds, settlement drift, over-settlement, unresolved-operation conflicts, and final-apply consistency checks for booking version/current terms/current price, target selection, inventory protection, target price, and adjustment identity.

Full repository typecheck/lint/build, Prisma validation/migration execution, and PostgreSQL integration tests still require the repository Node 24 toolchain and a confirmed disposable PostgreSQL target. The final apply service therefore remains subject to that database-backed locking/persistence validation gate before Phase 13 can be considered complete.
