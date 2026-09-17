# Rental booking staff workflow

SF exposes a staff-facing interaction layer for the durable rental booking foundation. Staff can review an effective physical-unit hold against an active tenant customer, confirm the booking through the atomic writer, read paginated rental booking history/detail, apply supported same-unit price-neutral date reschedules, apply supported same-type/same-location physical-unit substitutions, record supported manual/offline booking settlement evidence and refunds, cancel a confirmed booking only after booking-price settlement is reconciled to zero, record pickup/return custody, explicitly release complete remaining rental days after an early return, record append-only return-condition inspection and damage-case evidence, retain customer-damage-liability decisions and supported exact manual/offline damage settlement, manage supported security-bond evidence/disposition, and retain explicit late-return assessment plus supported exact manual/offline late-fee settlement.

The workflow does not invent public/online rental payment collection, unit-type/location-changing amendments, price-changing amendments, delivery, automatic late-fee policy, partial/split/provider-backed settlement, notifications, or external fulfillment integrations.

## Routes

- `/inventory/rentals/holds/[hold-id]` reviews one effective rental hold against an active tenant customer.
- `POST /api/inventory/rentals/holds/[hold-id]/confirm` derives tenant, actor, and confirmation idempotency authority from authenticated server context before calling `confirmRentalBookingFromHold`.
- `/inventory/rentals/bookings` is the tenant-scoped, paginated staff read model with lifecycle filtering, committed dates, current effective unit, current fulfillment state, overdue-custody/missed-pickup operational queues, and any early-return inventory-release indicator.
- `/inventory/rentals/bookings/[booking-id]` renders immutable booking-time evidence, current allocation, append-only reschedule/substitution/fulfillment/return evidence, operational return workflows, and separately permissioned commercial evidence.
- `/inventory/rentals/bookings/[booking-id]/reschedule` reviews target dates and only renders Apply when fresh authority is ready and the actor can manage availability.
- `POST /api/inventory/rentals/bookings/[booking-id]/reschedule` derives tenant, actor, and idempotency authority server-side and calls the durable reschedule writer.
- `/inventory/rentals/bookings/[booking-id]/unit-substitution` searches bounded same-type/same-location candidate units and runs fresh target-inventory authority review only before custody transfer and before the exclusive committed pickup end.
- `POST /api/inventory/rentals/bookings/[booking-id]/unit-substitution` derives tenant, actor, and idempotency server-side and rechecks fulfillment and pickup-window authority under locks.
- `POST /api/inventory/rentals/bookings/[booking-id]/payments/manual` records only real external manual/offline booking-price payment evidence for the server-derived exact amount.
- `POST /api/inventory/rentals/bookings/[booking-id]/payments/refunds` records only real external booking-price refund evidence for the server-derived source and amount.
- `POST /api/inventory/rentals/bookings/[booking-id]/cancel` derives tenant and actor server-side and calls the terminal cancellation writer.
- `POST /api/inventory/rentals/bookings/[booking-id]/pickup` and `/return` append server-authorized physical-custody evidence.
- `POST /api/inventory/rentals/bookings/[booking-id]/inventory-release` shortens only live inventory protection after an eligible early return.
- `POST /api/inventory/rentals/bookings/[booking-id]/return-inspection` binds one condition outcome to retained `RETURNED` custody evidence.
- `POST /api/inventory/rentals/bookings/[booking-id]/damage-case` opens the supported operational damage case from retained non-clear inspection evidence.
- `POST /api/inventory/rentals/bookings/[booking-id]/damage-case/[case-id]` performs only supported assess/waive/close damage transitions.
- `POST /api/inventory/rentals/bookings/[booking-id]/damage-case/[case-id]/liability` retains the post-closure customer-liability decision.
- `POST /api/inventory/rentals/bookings/[booking-id]/damage-case/[case-id]/settlement/manual` and `/refund` retain supported exact full-value manual/offline customer-damage settlement evidence.
- Security-bond requirement, collection, release, and supported exact forfeiture actions remain separate booking-scoped payment evidence routes and do not mutate the booking price.
- `POST /api/inventory/rentals/bookings/[booking-id]/late-return-assessment` retains the explicit post-return grace/fee-or-waiver decision from immutable custody evidence.
- `POST /api/inventory/rentals/bookings/[booking-id]/late-return-assessment/[assessment-id]/settlement/manual` and `/refund` retain supported exact full-value manual/offline settlement evidence for an assessed late-return fee.

All routes remain inside the authenticated SF application shell. No public/customer rental booking, payment, modification, custody, inspection, damage, bond, late-return, or settlement route is introduced.

## Authorization and tenant scope

Rental booking list/detail reads require `booking:read`; every booking query repeats the authenticated `organizationId`.

Hold conversion review requires `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `customer:read`; confirmation additionally requires `availability:manage`.

Reschedule review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`. Apply additionally requires `availability:manage`.

Replacement-unit candidate search requires `booking:manage` plus `inventory:read`; fresh substitution authority review additionally requires `availability:read`; apply additionally requires `availability:manage`. Candidate IDs never grant ownership authority.

Booking-price payment history requires `payment:read`; manual payment/refund recording requires `payment:manage`. Damage liability, damage settlement, security-bond settlement/disposition, and late-return assessment/settlement also repeat their documented booking/payment permission combinations and tenant scope server-side. UI permission checks remain usability only.

Cancellation requires `booking:manage` plus `availability:manage` and independently rechecks the tenant booking, current effective allocation, settlement state, and pre-pickup lifecycle.

Pickup, return, early-return inventory release, return-inspection recording, and damage-case writes require both `booking:manage` and `inventory:manage`. Their writers repeat tenant scope and never trust browser-supplied tenant, actor, unit, custody timestamp, or booking authority.

Commercial damage and late-return reads require both `booking:read` and `payment:read`; their writes require both `booking:manage` and `payment:manage`. Currency, amount authority, source evidence, actor, tenant, and idempotency are derived server-side/database-side.

## Confirmation authority

The browser-visible conversion review is never write authority. Confirmation reacquires idempotency and physical-unit locks, uses PostgreSQL time, revalidates active tenant customer/hold/unit/location state, checks inventory and current pricing, compares the conversion fingerprint, consumes the hold, creates the durable booking/allocation, and writes an audit event atomically.

## Reschedule and substitution authority

Rental rescheduling remains intentionally narrow: the current effective physical unit, retained unit type/location, currency, and aggregate accepted amount do not change. Original booking-time evidence remains immutable while target inventory and pricing are rebuilt at review and again under write locks.

Successful reschedule inserts append-only evidence, moves only effective allocation dates, advances the booking version, and writes an audit event. New reschedules fail closed after pickup custody evidence exists.

Physical-unit substitution remains same-type/same-location and price-neutral. Apply locks the booking plus source/target physical units in deterministic order, revalidates the source allocation and target availability/lifecycle, inserts append-only substitution evidence, and changes only the effective allocation unit. Immutable booking-time `RentalBooking.unitId` remains unchanged.

See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md), [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md), and [rental-booking-pickup-window.md](./rental-booking-pickup-window.md).

## Payment and commercial settlement authority

Booking-price settlement, customer-damage settlement, security-bond settlement/disposition, and late-return fee settlement are separate ledgers/authority boundaries. None is allowed to silently mutate the immutable accepted rental booking total.

The enabled booking-price, damage, bond, and late-return payment paths use real manual/offline evidence only where explicitly documented. Browser forms do not submit authoritative tenant identity, actor identity, currency, amount, refund source, or idempotency. Manual references are isolated across rental settlement ledgers at the PostgreSQL boundary so one real-world receipt/refund identifier cannot represent multiple commercial events in the same tenant.

Late-return assessment is also separate from settlement: staff first retain explicit case-specific grace and fee/waiver authority from immutable return evidence. Only a retained positive `FEE_ASSESSED` decision can feed the full-value manual/offline late-return settlement workflow. A waived assessment cannot be paid.

See [rental-payment-foundation.md](./rental-payment-foundation.md), [rental-damage-liability.md](./rental-damage-liability.md), [rental-damage-settlement.md](./rental-damage-settlement.md), [rental-late-return-assessment.md](./rental-late-return-assessment.md), and [rental-late-return-settlement.md](./rental-late-return-settlement.md).

## Cancellation authority

Cancellation is an inventory-release lifecycle mutation, not a refund action. It uses the shared tenant/booking lock plus current effective physical-unit lock and validates current allocation after reschedule/substitution. It is pre-pickup only and fails closed when commercial evidence that requires disposition has not been reconciled according to its own contract.

## Fulfillment, inspection, damage, and late-return authority

The supported physical-custody state machine is `AWAITING_PICKUP -> PICKED_UP -> RETURNED`. Pickup and return are append-only tenant-owned evidence, not mutable booking status values.

Pickup/return writers lock the tenant booking and current effective physical unit, validate the exact allocation after reschedule/substitution, use PostgreSQL time, derive idempotency server-side, and write audit evidence atomically. Once pickup exists, cancellation, rescheduling, and physical-unit substitution are blocked. Return requires prior pickup and cannot predate it.

After return, early-return release can shorten only live inventory protection for complete remaining rental days. Separately, return inspection can retain one condition outcome against the exact returned unit/event. Non-clear outcomes quarantine an available unit before inspection evidence is inserted.

A retained non-clear inspection can feed one operational damage case. Assessment stores an exact repair estimate in booking currency; customer liability is a separate post-closure commercial decision. Supported damage settlement and security-bond forfeiture remain separate from those operational facts.

Late-return assessment uses the immutable pickup/return snapshot, retained location timezone, and exclusive committed end date. Staff explicitly retain a 0–30 day case-specific grace decision and either positive fee authority or a waiver. PostgreSQL independently derives the late-day chronology. A fee assessment can then feed the separate exact manual/offline settlement workflow without reopening custody or changing allocation.

See [rental-booking-fulfillment-foundation.md](./rental-booking-fulfillment-foundation.md), [rental-early-return-inventory-release.md](./rental-early-return-inventory-release.md), [rental-return-inspection.md](./rental-return-inspection.md), [rental-damage-case.md](./rental-damage-case.md), [rental-damage-liability.md](./rental-damage-liability.md), [rental-late-return-assessment.md](./rental-late-return-assessment.md), and [rental-late-return-settlement.md](./rental-late-return-settlement.md).

## Read model

`listRentalBookings` requires `booking:read`, enforces tenant scope, caps page size at 100, and supports lifecycle filters plus overdue-custody and missed-pickup operational queues.

`getRentalBooking` resolves one tenant booking plus bounded append-only reschedule, substitution, fulfillment, and early-return-release evidence. Dedicated tenant-scoped services read condition/damage/commercial evidence according to their additional permissions.

Settlement readers reconcile complete bounded evidence for their enabled contracts instead of inferring state from the visible UI or mutating the booking row.

## Deliberate boundaries

This workflow does not implement or imply public card collection, Stripe rental checkout, split/tendered settlement, partial late-return settlement, partial security-bond offsets, unit-type changes, location-changing substitutions, price-changing reschedules/amendments, automatic tenant-wide late-fee policy, delivery, public self-service, notifications, invoices, external fleet synchronization, or provider-backed late-return/damage/bond collection.

Implemented manual/offline settlement actions record evidence only after real external money movement. No dead primary action or mock provider behavior is presented as real.

## Validation

Focused domain tests protect the relevant booking, fulfillment, damage, security-bond, late-return, and settlement state derivations. Source-contract tests protect tenant/permission scope, safe route parsing, locking/idempotency, PostgreSQL authority, append-only evidence, database-authored time, real UI wiring, and deliberate provider boundaries.

`scripts/rental-late-return-source-contract.test.mjs` protects assessment source/time authority. `scripts/rental-late-return-settlement-source-contract.test.mjs` protects exact manual/offline late-fee settlement and four-ledger manual-reference isolation. `scripts/rental-damage-settlement-source-contract.test.mjs` also protects safe form parsing for the neighboring damage-settlement routes.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
