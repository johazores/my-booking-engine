# Rental booking effective settlement

SF has a protected effective-settlement model for rental bookings and a supported manual/offline post-apply refund writer. The model reconciles the immutable original booking-price ledger, the one supported applied price-changing commercial amendment, and append-only post-apply refund evidence without rewriting accepted booking money.

`RentalBooking.totalMinor` remains the booking-time snapshot. After an applied commercial date amendment, financial authority comes from combined retained evidence rather than that original total alone.

## Authority and tenant scope

`readRentalBookingEffectiveSettlement` validates organization, actor, and booking identifiers, requires `booking:read` plus `payment:read`, and runs under `RepeatableRead`.

Original booking-price evidence uses the bounded rental payment-history reader. Commercial-amendment authority is read tenant-scoped across both `PREPARED` and `APPLIED` states. A `PREPARED` amendment is unresolved commercial authority, not terminal settlement authority, so effective settlement fails closed until staff finish, compensate, cancel, or expire that workflow. Applied amendment settlement rows are request-fingerprint checked. Post-apply refund evidence is bounded, scoped by tenant/booking/amendment, chronology checked against apply time, and re-derives deterministic idempotency/request fingerprints.

`recordRentalBookingPostApplyManualRefund` requires `booking:manage` plus `payment:manage`, runs under `Serializable`, takes the shared tenant/booking lock, and re-reads effective settlement inside the write transaction.

## Effective commercial math

Without a prepared or applied amendment, effective settlement is the normal reconciled booking-price settlement.

For an applied `ADDITIONAL_CHARGE`, the amendment adjustment payment is a separate source. Post-apply refunds unwind that amendment source first; only after it reaches zero does server allocation move to original booking-price sources.

For an applied `REFUND`, the amendment adjustment already consumed refundable value from a retained original payment source. Later post-apply refunds cannot reuse that consumed value.

Post-apply refund requests never choose a source. `deriveRentalBookingEffectiveRefundPlan` selects the next authoritative retained source. One write cannot span sources, and the requested amount must fit the current source balance.

The settlement exposes original total, effective accepted total, combined current net, refund decomposition, full-funding/refund state, and next authoritative refund source.

## Durable post-apply refund evidence

`RentalBookingEffectiveRefundTransaction` is append-only and retains organization, booking, applied amendment, deterministic idempotency, request fingerprint, source ledger, refund/provider reference, retained source payment reference, currency, amount, and database-authored time.

Only the manual/offline provider contract is enabled. Provider interaction stays behind `ManualPaymentProvider`.

PostgreSQL independently requires a tenant-owned `APPLIED` amendment and successful manual evidence, caps refunds per retained source, and keeps the tenant-wide rental manual-reference namespace isolated across ledgers.

## Authenticated staff workspace

The commercial amendment workspace displays effective combined settlement after apply. When a positive refundable balance exists and the actor has booking/payment management authority, it exposes a manual/offline refund evidence form.

The form accepts a human major-unit amount plus unique real-world refund reference. It does not accept currency or source. The action route reads current effective settlement to resolve currency, converts the human amount with the shared money parser, then the writer reacquires the booking lock and independently selects/caps the retained source.

The UI shows the next server-derived source and per-write maximum only as guidance. Stale UI cannot grant authority because the writer re-reads and replans under lock.

Manual/offline refund recording means the real refund already happened outside SF. The staff action retains that evidence; it does not execute an online refund.

## Cancellation authority

Rental cancellation consumes this combined effective settlement under the shared booking lock. It requires reconciled evidence, immutable booking money agreement, `fullyRefunded: true`, and exact `currentNetSettledMinor === 0n`.

A `PREPARED` commercial amendment makes the effective settlement deliberately unreconciled because that workflow may still own adjustment or compensation evidence and can still become the accepted commercial change. Staff must finish, compensate, cancel, or expire it before booking cancellation can become terminal authority.

PostgreSQL independently enforces the same lifecycle boundary: a prepared amendment blocks the `CONFIRMED -> CANCELLED` booking transition, while the existing effective-settlement guard handles ordinary booking-price and `APPLIED` amendment money. Cancellation itself never records a refund or performs provider I/O.

## Date and physical-unit interaction

Effective settlement remains anchored to the one applied price-changing amendment even when a later same-unit price-neutral reschedule or custody extension changes dates. Those later reschedules must preserve the amendment currency and exact `afterTotalMinor`, so they do not alter the combined money model.

Before custody transfer, a same-type/same-location physical-unit substitution may also continue after apply only when it preserves the same effective dates, amendment currency, exact `afterTotalMinor`, and latest pricing fingerprint. Substitution evidence carries that accepted effective commercial amount while immutable original booking money remains unchanged. A `PREPARED` amendment still blocks replacement until the commercial workflow is finished, compensated, or closed.

A second price-changing amendment remains blocked.

## Fail-closed behavior

Reconciliation fails rather than guessing on incomplete history, any prepared commercial amendment, multiple applied amendments, mismatched terminal reschedule evidence, invalid fingerprints, inconsistent currencies/arithmetic, compensated or malformed applied adjustment evidence, wrong-ledger refunds, duplicate references, source over-refunds, chronology violations, or impossible balances.

The writer also fails closed on stale effective state, unsupported providers, duplicate/conflicting idempotency evidence, reference reuse, and requested amounts that would span sources.

## Current boundary

Post-apply manual refund recording, authenticated staff orchestration, exact-zero cancellation, later same-unit price-neutral date changes, and pre-custody same-type/same-location unit substitutions are implemented for the one supported manual/offline commercial amendment.

Chained price-changing amendments remain blocked after that applied amendment. Direct writes to the original booking-price ledger remain blocked. Provider-backed/online refund execution remains later adapter-backed scope.

## Validation

- `src/server/bookings/rental-booking-effective-settlement-domain.test.ts` covers combined reconciliation.
- `src/server/bookings/rental-booking-effective-refund-domain.test.ts` covers source ordering, fail-closed evidence, amount authority, and deterministic request evidence.
- `scripts/rental-booking-effective-settlement-source-contract.test.mjs` protects the read boundary.
- `scripts/rental-prepared-amendment-cancellation-guard-source-contract.test.mjs` protects prepared-amendment settlement/cancellation blocking at service, UI-consumption, PostgreSQL, and documentation boundaries.
- `scripts/rental-booking-effective-refund-source-contract.test.mjs` protects persistence, database caps, permission/locking/provider use, bounded history, and authenticated staff wiring.
- `scripts/rental-booking-commercial-amendment-staff-orchestration-source-contract.test.mjs` protects the staff refund handoff.
- `scripts/rental-post-commercial-neutral-reschedule-source-contract.test.mjs` protects price-neutral date continuation without changing effective money.
- `scripts/rental-post-commercial-unit-substitution-source-contract.test.mjs` protects physical-unit substitution without changing effective money.
- `scripts/rental-booking-cancellation-source-contract.test.mjs` protects exact-zero cancellation consumption.
- Full repository validation remains `npm run validate` under the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
