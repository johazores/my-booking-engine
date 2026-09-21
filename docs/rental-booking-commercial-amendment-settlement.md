# Rental booking commercial amendment settlement

SF has a tenant-scoped manual/offline settlement and compensation contract for a prepared same-unit rental commercial amendment. It is separate from `RentalPaymentTransaction`, which remains the immutable original booking-price ledger.

Authenticated staff orchestration now consumes this contract. The UI records real external manual/offline evidence only; it never treats a browser action as payment execution and never allows browser-authored currency, delta, provider code, tenant, actor, idempotency, or refund-source authority.

## Settlement states

`deriveRentalBookingCommercialAmendmentSettlementState` recognizes only:

- `UNSETTLED` — no adjustment evidence;
- `SETTLED` — exactly one successful manual adjustment matching the retained amendment delta;
- `COMPENSATED` — that exact adjustment plus one exact reverse compensation; or
- `CONFLICT` — any unsupported or inconsistent evidence.

For `ADDITIONAL_CHARGE`, adjustment is one exact `OFFLINE_PAYMENT`; compensation is a source-attributed refund against that payment.

For `REFUND`, adjustment is one exact source-attributed refund against a retained successful manual booking-price payment with enough remaining capacity; compensation is one exact `OFFLINE_PAYMENT` restoring the delta.

Partial adjustment money, multiple adjustments, ambiguous provider states, currency drift, and one adjustment refund spanning multiple retained payment sources are not supported.

## Durable evidence and database authority

`RentalBookingCommercialAmendmentSettlementTransaction` is append-only tenant evidence linked by `(amendmentId, bookingId, organizationId)`. It retains deterministic idempotency, request fingerprint, lifecycle purpose, kind, successful provider/reference evidence, source attribution when relevant, exact currency/amount, and database-authored time.

PostgreSQL independently enforces tenant ownership, exact currency/delta, supported direction/kind shape, one adjustment and one compensation, live preparation for new adjustment money, exact reverse compensation, append-only rows, and tenant-wide manual-reference isolation.

The physical PostgreSQL identifiers for this unusually long settlement table use explicit compact names. This is intentional: the target PostgreSQL identifier boundary is 63 bytes, so several former generated-style index names collapsed to the same stored identifier and the later readiness trigger collapsed onto the existing authority trigger. The creation migration now assigns distinct compact keys/indexes and the readiness trigger has its own compact name while preserving authority -> readiness -> cross-scope execution order. The Prisma `map` names match those physical objects, and the source contract protects both identifier length and truncation uniqueness.

`PREPARED -> CANCELLED/EXPIRED` is blocked while successful adjustment money remains uncompensated. `PREPARED -> APPLIED` is blocked unless exactly one successful uncompensated adjustment exists.

## Server services

`recordRentalBookingCommercialAmendmentManualSettlement` requires `booking:manage` plus `payment:manage`, uses the shared booking lock and amendment-settlement lock, and calls the existing `ManualPaymentProvider` adapter.

For a refund amendment, the browser submits only the new real-world refund reference. SF reads the complete bounded booking-price settlement history inside the transaction, verifies that the original accepted amount remains fully paid, applies retained prior commercial-amendment refund consumption, and deterministically selects the retained manual payment source with the largest remaining refundable capacity. The exact amendment refund fails closed if no single source can cover the retained delta. The writer repeats this source derivation under the booking lock immediately before recording evidence, so a stale page cannot choose or preserve obsolete refund-source authority.

`recordRentalBookingCommercialAmendmentManualCompensation` is the recovery boundary. It remains available after preparation expiry while the amendment stays `PREPARED`, because already-moved real money may need to be reversed. It appends only exact reverse evidence.

`readRentalBookingCommercialAmendmentSettlement` requires `booking:read` plus `payment:read`. It uses PostgreSQL `clock_timestamp()` for the displayed preparation-live state and, for an unsettled refund amendment, exposes only the server-derived refund-source readiness used by the staff workspace.

## Authenticated staff orchestration

The commercial workspace at `/inventory/rentals/bookings/[booking-id]/commercial-amendments/[amendment-id]` renders the retained state and only enables operations compatible with it:

- live `UNSETTLED` preparation: record exact adjustment evidence;
- `SETTLED`: final apply while live, or exact compensation;
- expired `SETTLED`: compensation only;
- `UNSETTLED` or `COMPENSATED`: close/expire without apply;
- `APPLIED`: combined effective settlement and supported post-apply refund recording;
- terminal states: read-only evidence.

For a refund adjustment, the workspace displays the current server-selected retained source as read-only evidence. It does not render a payment-source selector and does not enumerate a client-authoritative source list. The action route does not accept a refund-source form field.

Manual/offline staff actions record evidence only after real money has moved outside SF. No card collection, online refund execution, or fake provider workflow is represented as real.

The action route derives tenant and actor from authenticated mutation context. Final apply additionally requires an explicit `APPLY` confirmation, then the apply service independently revalidates all durable authority.

## Final apply and post-apply boundary

A `SETTLED` adjustment is consumed only by `applyRentalBookingCommercialAmendment`. Final apply re-locks and revalidates booking version, custody, unit allocation, inventory, pricing, original booking settlement, and exact uncompensated adjustment evidence.

After apply, the protected [effective settlement contract](./rental-booking-effective-settlement.md) combines original booking-price transactions, the retained amendment adjustment, and append-only post-apply refunds.

`recordRentalBookingPostApplyManualRefund` derives the next source server-side. Exact-zero cancellation consumes the same combined settlement.

Only one price-changing amendment remains supported. Later same-unit price-neutral reschedules/extensions may continue when fresh pricing preserves the applied amendment currency and exact `afterTotalMinor`; another price change and direct writes to the original booking-price ledger remain blocked. Before custody transfer, same-type/same-location physical-unit substitution may also continue when it preserves the same effective dates, applied amendment currency, exact `afterTotalMinor`, and latest pricing fingerprint. A `PREPARED` amendment still freezes substitution until that commercial workflow is finished, compensated, or closed.

## Validation

- `src/server/bookings/rental-booking-commercial-amendment-settlement-domain.test.ts` covers exact direction-aware settlement/compensation and deterministic refund-source allocation.
- `scripts/rental-booking-commercial-amendment-settlement-source-contract.test.mjs` protects persistence, database authority, PostgreSQL identifier portability, trigger-order uniqueness after identifier truncation, reference isolation, provider-adapter use, server-owned refund-source authority, compensation, and real staff wiring.
- `scripts/rental-booking-commercial-amendment-staff-orchestration-source-contract.test.mjs` protects the authenticated UI/route lifecycle and database-time readiness boundary.
- `scripts/rental-booking-commercial-amendment-refund-source-authority-source-contract.test.mjs` protects the focused no-browser-source contract.
- `scripts/rental-booking-commercial-amendment-apply-source-contract.test.mjs` protects final apply.
- `scripts/rental-post-commercial-neutral-reschedule-source-contract.test.mjs` protects post-apply neutral reschedule authority.
- `scripts/rental-post-commercial-unit-substitution-source-contract.test.mjs` protects post-apply physical-unit substitution commercial authority.
- `scripts/rental-booking-effective-settlement-source-contract.test.mjs` and `scripts/rental-booking-effective-refund-source-contract.test.mjs` protect post-apply money authority.
- Full repository validation remains `npm run validate` under the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
