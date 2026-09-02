# Commercial booking adjustments

SF has an authenticated, tenant-scoped price-impact review contract and now also has the durable internal amendment boundary required before any non-zero commercial booking change can be paid and applied.

## Price review

`POST /api/bookings/hospitality/[booking-id]/modify/preview` accepts normalized room type, rate plan, room quantity, add-on selections, and a booking idempotency key. The server derives organization and actor authority from the authenticated request context and requires `booking:manage`.

The review re-reads the tenant-owned confirmed booking, validates the active target room/rate assignment and traveler occupancy, recalculates current persisted pricing, and compares immutable current booking money with the proposed quote using integer minor units only. It returns current/proposed component totals, the signed price delta, booking version, selection fingerprint, and a deterministic SHA-256 adjustment fingerprint.

`ADDITIONAL_CHARGE` and `REFUND` in the review are price-delta directions. They are not permission for the browser to charge or refund money and must not be interpreted as authoritative settlement instructions without reconciling payment history.

## Durable amendment preparation

`prepareHospitalityBookingCommercialAmendment` is an internal service boundary. It is intentionally not exposed as a route or primary UI action until provider execution and final apply/recovery are complete.

Preparation requires both `booking:manage` and `payment:manage`, serializes on the shared booking and inventory advisory locks, and accepts the reviewed adjustment fingerprint rather than trusting browser-supplied price or settlement data. It then:

- re-reads the tenant-owned confirmed booking and verifies that allocation matches the booking's persisted room and quantity;
- refuses every unresolved `PENDING` or `AMBIGUOUS` payment transaction;
- currently requires a fully paid booking with one reconciled supported settlement source (`manual` or `stripe`) matching the authoritative booking total;
- revalidates room/rate assignment, occupancy, restrictions, add-ons, and current transactional pricing;
- rejects a stale review when the recalculated adjustment fingerprint differs;
- snapshots immutable current and target commercial terms plus before/after monetary components in `HospitalityBookingCommercialAmendment`;
- protects only the inventory that would otherwise be lost while payment is arranged: the full target quantity when changing room type, or only incremental units for a same-room-type quantity increase;
- uses the normal tenant-scoped `HospitalityAvailabilityHold` core for that protection and a bounded 15-minute amendment lifetime;
- records truthful prepared/expired/cancelled audit events; and
- supports idempotent preparation and cancellation without mutating the booking itself.

Same-room decreases and rate/add-on-only changes do not create artificial inventory holds. They still expire after the same bounded review window so pricing and booking version cannot remain actionable indefinitely.

## Database invariants

The amendment migration adds tenant-safe foreign keys to organization, booking, property, current/target room type, current/target rate plan, and optional target hold. Database checks enforce positive quantities, non-negative monetary components, exact component totals, `delta = after - before`, direction/sign agreement, hold/protection consistency, and terminal lifecycle timestamps.

The browser cannot supply organization ownership, current booking money, payment provider authority, current settlement amount, or inventory authority.

## Still intentionally closed

Preparing an amendment does not charge, refund, apply inventory changes, or rewrite booking/payment state. There is no public or staff route for preparation yet because exposing a workflow that cannot finish would create a dead primary action.

The Phase 13 general commercial modification item remains open. The next dependency is provider-aware payment execution and durable recovery for a prepared amendment, followed by a final serializable apply transaction that revalidates amendment expiry, booking version, payment outcome, target inventory protection, and current pricing before atomically replacing booking commercial terms/allocation and recording audit history. Unpaid, authorized, partially refunded, fully refunded, and otherwise unreconciled bookings remain fail-closed until their exact settlement-adjustment semantics are defined.

## Validation

Dependency-free amendment-domain tests cover room-type changes, same-room quantity increases/decreases, bounded expiry, deterministic hold identity, and malformed fingerprints. Full repository typecheck/lint/build, Prisma validation/migration execution, and PostgreSQL integration tests still require the repository Node 24 toolchain and a confirmed disposable PostgreSQL target.
