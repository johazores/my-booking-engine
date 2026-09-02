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
- derives authoritative net settled money from the full tenant-owned payment ledger and refuses every unresolved `PENDING` or `AMBIGUOUS` operation, cross-currency success, duplicate provider evidence, unresolved internal provider claim, missing/invalid refund-source attribution, or source-level over-refund;
- currently requires a fully paid booking whose **net** settled amount equals the authoritative booking total and whose successful settlement/refund history belongs to one supported provider (`manual` or `stripe`);
- allows multiple successful sources from that same provider to participate in reconciliation when every refund can be tied to the exact settlement source it reduced;
- revalidates room/rate assignment, occupancy, restrictions, add-ons, and current transactional pricing;
- rejects a stale review when the recalculated adjustment fingerprint differs;
- snapshots immutable current and target commercial terms plus before/after monetary components in `HospitalityBookingCommercialAmendment`;
- protects only the inventory that would otherwise be lost while payment is arranged: the full target quantity when changing room type, or only incremental units for a same-room-type quantity increase;
- uses the normal tenant-scoped `HospitalityAvailabilityHold` core for that protection and a bounded 15-minute amendment lifetime;
- records truthful prepared/expired/cancelled audit events; and
- supports idempotent preparation and cancellation without mutating the booking itself.

Same-room decreases and rate/add-on-only changes do not create artificial inventory holds. They still expire after the same bounded review window so pricing and booking version cannot remain actionable indefinitely.

## Concurrent mutation boundary

A non-expired `PREPARED` amendment is an exclusive commercial-change window for that booking. Booking cancellation, date rescheduling, traveler snapshot changes, and zero-delta commercial mutations acquire the shared booking mutation lock and fail closed while that amendment is active. Customer-facing refund availability also reports the amendment conflict instead of presenting a refund action that cannot safely race the prepared commercial change.

The guard is tenant-scoped and treats an expired preparation as non-actionable. Idempotent retries and true no-op booking requests may still return their existing result because they do not mutate amendment inputs. Payment write boundaries must acquire the same booking mutation lock before starting a new settlement-changing operation; this keeps preparation and payment claims serializable rather than relying on UI state.

## Settlement and refund boundary

`deriveBookingSettlementSummary` is the shared payment-ledger reconciliation primitive for commercial decisions. It aggregates exact minor-unit successful settlement sources, avoids double-counting an authorization once its matching capture exists, and now attributes each successful refund to the settlement source it reduced. Source summaries expose gross source money, refunded money, and remaining money; provider and booking totals are derived from those source balances.

`PaymentTransaction.sourceProviderReference` persists that attribution for new refund operations. Manual refunds record the exact offline payment reference, and Stripe refund claims record the exact PaymentIntent/capture reference before crossing the provider boundary. Legacy unattributed refund rows remain reconcilable only when that provider has exactly one effective settlement source. If legacy refund history spans multiple sources without attribution, SF fails closed rather than guessing which source was reduced. Refunds that reference a missing source or exceed that source's settled money also fail closed.

Commercial amendment preparation can therefore prove multi-source same-provider net settlement without provider-level refund ambiguity. The general staff refund action still remains intentionally single-source because **allocation of a new refund across more than one source is a separate execution policy**. Persistence and reconciliation now know where a refund landed; they do not yet choose which source or sources a new multi-source refund should use.

## Database invariants

The amendment migration adds tenant-safe foreign keys to organization, booking, property, current/target room type, current/target rate plan, and optional target hold. Database checks enforce positive quantities, non-negative monetary components, exact component totals, `delta = after - before`, direction/sign agreement, hold/protection consistency, and terminal lifecycle timestamps.

The payment-ledger migration adds nullable `sourceProviderReference` for refund attribution. A database check permits the field only on `REFUND` rows and requires non-empty trimmed provider references when present. The tenant/provider/source reference is indexed for recovery and reconciliation. Existing rows remain nullable so a safe single-source legacy history can still be reconciled without a destructive backfill.

The browser cannot supply organization ownership, current booking money, payment provider authority, current settlement amount, refund-source authority, or inventory authority.

## Still intentionally closed

Preparing an amendment does not charge, refund, apply inventory changes, or rewrite booking/payment state. There is no public or staff route for preparation yet because exposing a workflow that cannot finish would create a dead primary action.

The Phase 13 general commercial modification item remains open. The next dependency is provider-aware payment execution and durable recovery for a prepared amendment, followed by a final serializable apply transaction that revalidates amendment expiry, booking version, authoritative net settlement, payment outcome, target inventory protection, and current pricing before atomically replacing booking commercial terms/allocation and recording audit history. Deterministic source selection/splitting is still required before adjustment-created multi-source histories can use the general refund action. Unpaid, authorized, partially refunded, fully refunded, mixed-provider, and otherwise unreconciled bookings remain fail-closed until their exact settlement-adjustment semantics are defined.

## Validation

Dependency-free amendment-domain tests cover room-type changes, same-room quantity increases/decreases, bounded expiry, deterministic hold identity, and malformed fingerprints. Focused payment settlement/refund-domain tests now cover explicit refund-to-source attribution, per-source refunded/remaining balances, safe legacy single-source fallback, fail-closed legacy multi-source refunds, unknown source references, source-level over-refunds, authorization/capture de-duplication, mixed providers, unresolved operations, internal claims, cross-currency rows, duplicate provider references, and general refund single-source enforcement. Full repository typecheck/lint/build, Prisma validation/migration execution, and PostgreSQL integration tests still require the repository Node 24 toolchain and a confirmed disposable PostgreSQL target.
