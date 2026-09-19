# Rental booking staff workflow

SF exposes a staff-facing interaction layer for the durable rental booking foundation. Staff can review an effective physical-unit hold against an active tenant customer, confirm the booking through the atomic writer, read paginated rental booking history/detail, apply supported same-unit price-neutral date reschedules before pickup, execute one supported same-unit price-changing commercial date amendment with exact retained adjustment evidence, apply the supported same-unit same-start later-end price-neutral custody extension after pickup and before return, apply supported same-type/same-location physical-unit substitutions, record supported manual/offline original booking settlement evidence before commercial authority takes ownership, record server-planned post-apply effective refunds, cancel a confirmed booking only after effective settlement is reconciled to exact zero, record pickup/return custody, explicitly release complete remaining rental days after an early return, record append-only return-condition inspection and damage-case evidence, retain customer-damage-liability decisions and supported exact manual/offline damage settlement, manage supported security-bond evidence/disposition, manage versioned unit-type late-return fee policy revisions, and retain explicit late-return assessment plus supported exact manual/offline late-fee settlement.

The workflow does not invent public/online rental payment collection, a second/chained price-changing commercial amendment, unit-type/location-changing amendments, delivery, generic split/provider-backed settlement, notifications, or external fulfillment integrations.

## Routes

- `/inventory/rentals/holds/[hold-id]` reviews one effective rental hold against an active tenant customer.
- `POST /api/inventory/rentals/holds/[hold-id]/confirm` derives tenant, actor, and confirmation idempotency authority from authenticated server context before calling `confirmRentalBookingFromHold`.
- `/inventory/rentals/bookings` is the tenant-scoped, paginated staff read model with lifecycle filtering, committed dates, current effective unit, current fulfillment state, overdue-custody/missed-pickup operational queues, and any early-return inventory-release indicator.
- `/inventory/rentals/bookings/[booking-id]` renders immutable booking-time evidence, current allocation, append-only reschedule/substitution/fulfillment/return evidence, operational return workflows, and separately permissioned commercial evidence. Its date-change action is labeled `Reschedule rental` before pickup and `Extend rental` while custody is active; returned bookings expose neither action.
- `/inventory/rentals/bookings/[booking-id]/reschedule` reviews target dates. Price-neutral authority can render the direct Apply action; the one supported same-currency price change instead hands staff into the retained commercial-amendment workflow.
- `POST /api/inventory/rentals/bookings/[booking-id]/reschedule` derives tenant, actor, and idempotency authority server-side and calls the durable direct reschedule writer only for supported price-neutral authority.
- `/inventory/rentals/bookings/[booking-id]/commercial-amendments/[amendment-id]` is the protected staff workspace for one retained price-changing amendment, exact manual/offline adjustment/compensation, final apply, and supported post-apply effective refunds.
- `POST /api/inventory/rentals/bookings/[booking-id]/commercial-amendments` prepares a fresh reviewed price-changing amendment from server-issued authority. `POST /api/inventory/rentals/bookings/[booking-id]/commercial-amendments/[amendment-id]` performs only the supported retained settle/compensate/apply/close/refund operation selected by the staff form; tenant, actor, amounts, provider identity, idempotency, and refund source remain server-owned.
- `/inventory/rentals/bookings/[booking-id]/unit-substitution` searches bounded same-type/same-location candidate units and runs fresh target-inventory authority review only before custody transfer and before the exclusive committed pickup end. After one applied commercial amendment, the same supported substitution remains available only when it preserves the accepted effective commercial baseline.
- `POST /api/inventory/rentals/bookings/[booking-id]/unit-substitution` derives tenant, actor, and idempotency server-side and rechecks fulfillment, commercial baseline, and pickup-window authority under locks.
- `POST /api/inventory/rentals/bookings/[booking-id]/payments/manual` records only real external manual/offline original booking-price payment evidence while that ledger remains writable.
- `POST /api/inventory/rentals/bookings/[booking-id]/payments/refunds` records only real external original booking-price refund evidence for the server-derived source and amount while that ledger remains writable.
- `POST /api/inventory/rentals/bookings/[booking-id]/cancel` derives tenant and actor server-side and calls the terminal cancellation writer.
- `POST /api/inventory/rentals/bookings/[booking-id]/pickup` and `/return` append server-authorized physical-custody evidence.
- `POST /api/inventory/rentals/bookings/[booking-id]/inventory-release` shortens only live inventory protection after an eligible early return.
- `POST /api/inventory/rentals/bookings/[booking-id]/return-inspection` binds one condition outcome to retained `RETURNED` custody evidence.
- `POST /api/inventory/rentals/bookings/[booking-id]/damage-case` opens the supported operational damage case from retained non-clear inspection evidence.
- `POST /api/inventory/rentals/bookings/[booking-id]/damage-case/[case-id]` performs only supported assess/waive/close damage transitions.
- `POST /api/inventory/rentals/bookings/[booking-id]/damage-case/[case-id]/liability` retains the post-closure customer-liability decision.
- `POST /api/inventory/rentals/bookings/[booking-id]/damage-case/[case-id]/settlement/manual` and `/refund` retain supported exact full-value manual/offline customer-damage settlement evidence.
- Security-bond requirement, collection, release, and supported exact forfeiture actions remain separate booking-scoped payment evidence routes and do not mutate the booking price.
- `/inventory/rentals/types/[unit-type-id]` shows the current late-return policy revision to pricing readers and real enable/update/disable controls to authorized pricing managers.
- `POST /api/inventory/rentals/unit-types/[unit-type-id]/late-return-policy` creates the next append-only policy revision under tenant/unit-type serialization and optimistic version authority.
- `POST /api/inventory/rentals/bookings/[booking-id]/late-return-assessment` retains the explicit post-return policy-derived or manual grace/fee-or-waiver decision from immutable custody evidence.
- `POST /api/inventory/rentals/bookings/[booking-id]/late-return-assessment/[assessment-id]/settlement/manual` and `/refund` retain supported exact full-value manual/offline settlement evidence for an assessed late-return fee.

All routes remain inside the authenticated SF application shell. No public/customer rental booking, payment, modification, custody, inspection, damage, bond, late-return, or settlement route is introduced.

## Authorization and tenant scope

Rental booking list/detail reads require `booking:read`; every booking query repeats the authenticated `organizationId`.

Hold conversion review requires `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `customer:read`; confirmation additionally requires `availability:manage`.

Reschedule review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Direct price-neutral apply additionally requires `availability:manage`. Commercial amendment preparation adds `payment:manage`; its staff workspace requires `booking:read` plus `payment:read`; settlement/compensation/close require booking/payment management; final apply additionally requires the documented availability/inventory/pricing authority.

Replacement-unit candidate search requires `booking:manage` plus `inventory:read`; fresh substitution authority review additionally requires `availability:read`; apply additionally requires `availability:manage`. Candidate IDs never grant ownership authority.

Booking-price payment history requires `payment:read`; manual payment/refund recording requires `payment:manage`. New original-ledger writes also require server/database proof that no `PREPARED` or `APPLIED` commercial amendment currently owns settlement authority. Damage liability, damage settlement, security-bond settlement/disposition, and late-return assessment/settlement repeat their documented booking/payment permission combinations and tenant scope server-side. UI permission checks remain usability only.

Late-return policy reads require `inventory:read` plus `pricing:read`. Creating the next append-only policy revision requires `inventory:read` plus `pricing:manage`; the service independently repeats authenticated tenant/unit-type scope and ignores browser authority for currency, revision number, effective time, actor, or tenant.

Cancellation requires `booking:manage` plus `availability:manage` and independently rechecks the tenant booking, current effective allocation, combined effective settlement state, and pre-pickup lifecycle.

Pickup, return, early-return inventory release, return-inspection recording, and damage-case writes require both `booking:manage` and `inventory:manage`. Their writers repeat tenant scope and never trust browser-supplied tenant, actor, unit, custody timestamp, or booking authority.

Commercial damage and late-return reads require both `booking:read` and `payment:read`; their writes require both `booking:manage` and `payment:manage`. Currency, amount authority, source evidence, actor, tenant, and idempotency are derived server-side/database-side.

## Confirmation authority

The browser-visible conversion review is never write authority. Confirmation reacquires idempotency and physical-unit locks, uses PostgreSQL time, revalidates active tenant customer/hold/unit/location state, checks inventory and current pricing, compares the conversion fingerprint, consumes the hold, creates the durable booking/allocation, and writes an audit event atomically.

## Reschedule, commercial amendment, and substitution authority

Rental date changes keep the current effective physical unit and retained unit type/location. Original booking-time evidence remains immutable while target inventory and pricing are rebuilt at review and again under write locks.

Before pickup, a price-neutral reschedule inserts append-only evidence, moves only effective allocation dates, advances the booking version, and writes an audit event. A same-currency price change does not use that direct writer: one supported change is retained as a commercial amendment with exact adjustment settlement, then final apply creates the linked reschedule only after fresh server revalidation. Once applied, `afterTotalMinor` is the effective accepted commercial baseline. Later same-unit date changes may continue only when current pricing preserves that exact effective amount; another price change remains unsupported.

After pickup and before return, date authority is the narrower custody extension: the effective start and unit remain fixed and the target end must move later. The direct path is price-neutral against the current accepted effective commercial baseline; the one supported commercial amendment can also originate from this custody-extension review before it has been consumed. Return closes further date changes. Cancellation and physical-unit substitution remain hard-locked after pickup.

Physical-unit substitution remains same-type/same-location and cannot itself change commercial value. Apply locks the booking plus source/target physical units in deterministic order, revalidates the source allocation, target availability/lifecycle, and effective commercial baseline, inserts append-only substitution evidence, and changes only the effective allocation unit. Immutable booking-time `RentalBooking.unitId` and `RentalBooking.totalMinor` remain unchanged. A `PREPARED` commercial amendment blocks substitution until its money workflow is resolved; after apply, substitution is allowed only at the retained effective total.

See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md), [rental-booking-commercial-amendments.md](./rental-booking-commercial-amendments.md), [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md), and [rental-booking-pickup-window.md](./rental-booking-pickup-window.md).

## Payment and commercial settlement authority

Original booking-price settlement, commercial-amendment adjustment/effective refunds, customer-damage settlement, security-bond settlement/disposition, and late-return fee settlement are separate ledgers/authority boundaries. None is allowed to silently mutate the immutable original rental booking total.

The enabled booking-price, amendment, damage, bond, and late-return payment paths use real manual/offline evidence only where explicitly documented. Browser forms do not submit authoritative tenant identity, actor identity, currency, amount, refund source, or idempotency. Manual references are isolated across rental settlement ledgers at the PostgreSQL boundary so one real-world receipt/refund identifier cannot represent multiple commercial events in the same tenant.

The original booking-price ledger freezes as soon as one commercial amendment is `PREPARED`. New direct payment/refund writes fail before manual-provider execution and PostgreSQL independently blocks direct inserts under the shared booking lock. Existing retained original-ledger evidence remains readable and idempotently replayable. `CANCELLED`/`EXPIRED` preparation releases the freeze; `APPLIED` keeps the original ledger historical and the effective settlement workflow owns later refund authority.

Late-return assessment is also separate from settlement. If an enabled unit-type policy revision was already effective at immutable return time, the server derives grace and daily-fee authority from that retained revision and the browser cannot override the math. When no enabled policy applied, the existing case-specific manual grace/fee path remains available. Staff still retain an explicit assessment or waiver with a required reason, and only a retained positive `FEE_ASSESSED` decision can feed the full-value manual/offline settlement workflow.

See [rental-payment-foundation.md](./rental-payment-foundation.md), [rental-booking-commercial-amendments.md](./rental-booking-commercial-amendments.md), [rental-booking-effective-settlement.md](./rental-booking-effective-settlement.md), [rental-damage-liability.md](./rental-damage-liability.md), [rental-damage-settlement.md](./rental-damage-settlement.md), [rental-late-return-policy.md](./rental-late-return-policy.md), [rental-late-return-assessment.md](./rental-late-return-assessment.md), and [rental-late-return-settlement.md](./rental-late-return-settlement.md).

## Cancellation authority

Cancellation is an inventory-release lifecycle mutation, not a refund action. It uses the shared tenant/booking lock plus current effective physical-unit lock and validates current allocation after reschedule/substitution. It is pre-pickup only and fails closed unless protected effective settlement proves an exact fully-refunded zero net, including the one supported applied commercial amendment when present.

## Fulfillment, inspection, damage, and late-return authority

The supported physical-custody state machine is `AWAITING_PICKUP -> PICKED_UP -> RETURNED`. Pickup and return are append-only tenant-owned evidence, not mutable booking status values.

Pickup/return writers lock the tenant booking and current effective physical unit, validate the exact allocation after reschedule/substitution, use PostgreSQL time, derive idempotency server-side, and write audit evidence atomically. Once pickup exists, cancellation and physical-unit substitution are blocked while date-change authority narrows to the same-unit, same-start, later-end custody extension. Return requires prior pickup, cannot predate it, and closes further date changes.

After return, early-return release can shorten only live inventory protection for complete remaining rental days. Separately, return inspection can retain one condition outcome against the exact returned unit/event. Non-clear outcomes quarantine an available unit before inspection evidence is inserted.

A retained non-clear inspection can feed one operational damage case. Assessment stores an exact repair estimate in booking currency; customer liability is a separate post-closure commercial decision. Supported damage settlement and security-bond forfeiture remain separate from those operational facts.

Late-return assessment uses the immutable pickup/return snapshot, retained location timezone, and exclusive committed end date. It resolves the latest unit-type policy revision already effective at the immutable return timestamp. An enabled revision supplies non-retroactive grace and exact daily-fee authority; otherwise staff use the supported case-specific manual grace/fee path. PostgreSQL independently derives late-day chronology and verifies policy-derived totals. A retained positive fee assessment can then feed the separate exact manual/offline settlement workflow without reopening custody or changing allocation.

See [rental-booking-fulfillment-foundation.md](./rental-booking-fulfillment-foundation.md), [rental-early-return-inventory-release.md](./rental-early-return-inventory-release.md), [rental-return-inspection.md](./rental-return-inspection.md), [rental-damage-case.md](./rental-damage-case.md), [rental-damage-liability.md](./rental-damage-liability.md), [rental-late-return-policy.md](./rental-late-return-policy.md), [rental-late-return-assessment.md](./rental-late-return-assessment.md), and [rental-late-return-settlement.md](./rental-late-return-settlement.md).

## Read model

`listRentalBookings` requires `booking:read`, enforces tenant scope, caps page size at 100, and supports lifecycle filters plus overdue-custody and missed-pickup operational queues.

`getRentalBooking` resolves one tenant booking plus bounded append-only reschedule, substitution, fulfillment, and early-return-release evidence. Dedicated tenant-scoped services read commercial-amendment, effective-settlement, condition/damage, bond, and late-return evidence according to their additional permissions.

Settlement readers reconcile complete bounded evidence for their enabled contracts instead of inferring state from the visible UI or mutating the booking row.

## Deliberate boundaries

This workflow does not implement or imply public card collection, Stripe rental checkout, split/tendered settlement, partial late-return settlement, partial security-bond offsets, a second/chained price-changing commercial amendment, unit-type changes, location-changing substitutions, delivery/one-way rules, public self-service, notifications, invoices, external fleet synchronization, or provider-backed amendment/late-return/damage/bond collection.

Implemented manual/offline settlement actions record evidence only after real external money movement. No dead primary action or mock provider behavior is presented as real.

## Validation

Focused domain tests protect the relevant booking, reschedule/commercial-amendment, fulfillment, damage, security-bond, late-return, and settlement state derivations. Source-contract tests protect tenant/permission scope, safe route parsing, locking/idempotency, PostgreSQL authority, append-only evidence, database-authored time, real UI wiring, and deliberate provider boundaries.

`scripts/rental-late-return-source-contract.test.mjs` protects assessment source/time authority. `scripts/rental-late-return-policy-source-contract.test.mjs` protects policy revision authority and effective-at-return fee math. `scripts/rental-late-return-policy-followup-source-contract.test.mjs` protects truthful policy staff feedback, independent unit/rate pagination, and reconciled source-of-truth docs. `scripts/rental-late-return-settlement-source-contract.test.mjs` protects exact manual/offline late-fee settlement and cross-ledger manual-reference isolation. `scripts/rental-damage-settlement-source-contract.test.mjs` protects safe form parsing for the neighboring damage-settlement routes. `scripts/rental-custody-extension-staff-discoverability-source-contract.test.mjs` protects the booking-detail extension action and extension-aware staff guidance after pickup. `scripts/rental-booking-commercial-amendment-staff-orchestration-source-contract.test.mjs` protects the supported commercial staff handoff. `scripts/rental-commercial-ledger-freeze-source-contract.test.mjs` protects the original-ledger ownership handoff and no-dead-action payment panel.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
