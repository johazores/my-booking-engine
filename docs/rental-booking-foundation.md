# Rental booking foundation

SF supports a staff-only rental booking writer that converts one reviewed tenant-owned `ACTIVE` rental hold into one durable `RentalBooking` and one durable physical-unit `RentalBookingAllocation`. The production booking surface now also includes tenant-scoped history/detail, same-unit price-neutral rescheduling before pickup, a narrow same-unit current-start/later-end price-neutral custody extension after pickup, same-type/same-location physical-unit substitution before pickup, terminal pre-pickup inventory-release cancellation, append-only multi-source partial/full manual/offline booking-price payment evidence with source-attributed partial/full refunds, append-only pickup/return custody evidence, explicit whole-day early-return inventory release, overdue open-custody availability protection, missed-pickup visibility, operational availability/maintenance work orders, return inspection and damage-case follow-up, customer-liability authority with exact manual settlement or exact bond forfeiture, security-bond collection/release evidence, versioned unit-type late-return fee policy revisions with non-retroactive automatic fee math, and explicit late-return assessment plus exact manual/offline fee settlement. Online/card or other provider-backed rental settlement, price-changing/broader extensions, delivery, notifications/external synchronization, and customer self-service remain separate production contracts.

## Confirmation contract

`confirmRentalBookingFromHold` requires:

- an authenticated tenant ID and actor ID
- `booking:manage`
- `availability:read`
- `availability:manage`
- `customer:read`
- an active tenant hold with immutable pricing evidence
- an active tenant customer
- active unit/type/location evidence matching the hold
- no unavailable block, competing effective hold, non-cancelled booking allocation, or overdue open custody on the held physical unit
- current pricing equal to the held currency, total, and pricing fingerprint
- a valid server-rebuilt confirmation authority fingerprint

The booking writer ignores browser authority for tenant, actor, customer, unit, dates, pricing, idempotency, or conversion chronology except the reviewed hold ID and authority fingerprint. The canonical idempotency key is derived from the tenant hold.

## Durable booking evidence

A successful conversion persists immutable booking-time evidence including:

- organization
- source hold
- customer link plus booking-time customer name/contact snapshot
- physical unit, unit type, location, and accepted date range
- accepted currency and exact minor-unit total
- pricing fingerprint and bounded pricing snapshot
- conversion authority fingerprint
- confirmation timestamp from PostgreSQL time
- deterministic confirmation idempotency key

`RentalBookingAllocation` is the operational physical-unit/date commitment. It starts equal to booking-time dates and unit, then may move only through supported append-only reschedule/extension and substitution lifecycles. `RentalBooking` retains the original booking-time commercial and physical-assignment evidence.

## Tenant isolation and authorization

Every read and mutation repeats authenticated `organizationId`. IDs such as hold ID, booking ID, customer ID, unit ID, target-unit ID, payment reference, idempotency key, and authority fingerprint never grant tenant scope by themselves.

Booking reads require `booking:read`. Booking confirmation requires booking/availability/customer authority. Reschedule/extension review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`; apply additionally requires `availability:manage`. Unit substitution requires booking/availability/inventory authority. Cancellation requires `booking:manage` plus `availability:manage` and zero net booking-price settlement. Pickup/return and early-return inventory release require `booking:manage` plus `inventory:manage`. Payment, liability, bond, and late-return settlement surfaces add the relevant `payment:*` permissions. Late-return fee-policy reads require `inventory:read` plus `pricing:read`; append-only policy revisions require `inventory:read` plus `pricing:manage`.

## Booking locks and database authority

Confirmation uses serializable application transactions, tenant/hold serialization, and the shared tenant/physical-unit advisory lock before consuming hold authority and writing booking/allocation evidence. Database guards independently validate tenant ownership, immutable evidence, pricing/hold consistency, exact allocation, and live inventory conflicts.

Later booking mutations reuse the tenant/booking advisory lock and, where physical inventory can change, the effective physical-unit lock. Direct-write database guards repeat critical lifecycle boundaries instead of treating application code as the only source of truth.

## Date rescheduling and custody extension

Before pickup, authorized staff may review a different date range for the current effective physical unit. Current target inventory and pricing must be compatible with the existing accepted commercial contract; SF does not silently reprice an accepted booking.

After pickup and before return, the same append-only reschedule lifecycle becomes a narrow custody-extension contract. The current effective start date and physical unit are fixed; the target end must move strictly later; fresh inventory authority must still be available; and current target pricing must preserve the accepted currency and exact aggregate amount. Arbitrary in-custody rescheduling, shortening, changing the start, changing unit/type/location, and price-changing extension authority remain unsupported.

The review authority fingerprint is custody-aware. It binds the current booking version, effective unit, source and target dates, exact money, pricing fingerprints, mutation mode, and the immutable pickup-event ID when custody has started. A pre-pickup review cannot cross the pickup boundary unnoticed.

Apply reacquires booking and effective-unit locks, rechecks tenant lifecycle/custody, blocks/holds/other allocations/overdue custody, rebuilds pricing, verifies reviewed authority, inserts append-only `RentalBookingReschedule` evidence, moves only operational allocation dates, advances booking `updatedAt`, and records either `booking.rental.rescheduled` or `booking.rental.extended` audit evidence.

The database custody guard mirrors the distinction. Before pickup, the existing supported price-neutral reschedule contract remains available. After pickup, only source=current effective period, target start=current start, target end>current end is accepted, and the write cannot predate pickup evidence. Once return exists, no new reschedule or extension row is accepted. Cancellation and physical-unit substitution remain hard-locked after pickup.

See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

## Physical-unit substitution

Before pickup, authorized staff may replace the current effective unit with another active unit under the same retained unit type and operating location while dates and accepted money remain unchanged.

Candidate discovery is bounded and non-reserving. Fresh review uses PostgreSQL time plus the retained booking-location timezone and rejects missed-pickup bookings whose exclusive effective end has already been reached. Apply serializes the booking and both source/target unit locks in deterministic order, rechecks that no fulfillment evidence exists, revalidates target inventory authority, inserts append-only substitution evidence, moves only `RentalBookingAllocation.unitId`, advances booking version, and records audit evidence.

Original `RentalBooking.unitId` stays immutable booking-time evidence. Database guards derive the current effective unit from latest substitution history for later allocation, reschedule/extension, cancellation, and fulfillment authority.

See [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md) and [rental-booking-pickup-window.md](./rental-booking-pickup-window.md).

## Booking-price payment evidence

A confirmed booking may retain multiple real manual/offline payments recorded after each external settlement actually occurred. Authorized staff provide a normalized external reference and positive major-unit amount up to the current outstanding balance; tenant, actor, booking, currency, exact minor-unit conversion, deterministic idempotency, and outstanding-balance authority are server-derived. Manual references are isolated tenant-wide across booking-price, damage, security-bond, and late-return ledgers before provider-adapter I/O, with PostgreSQL independently enforcing the same cross-ledger boundary.

A later manual/offline refund may retain a partial or full amount against the next server-selected successful source payment. The exact source, remaining refundable source balance, booking refundable balance, and refund amount ceiling come from complete settlement evidence rather than browser authority. Every refund retains explicit source attribution.

Settlement reads complete tenant-owned payment history through bounded cursor pages and fail closed if the reconciliation safety limit is exceeded. Booking cancellation cannot commit while booking-price settlement is non-zero.

This workflow does not present card authorization, online checkout, online split-tender checkout, mixed-provider settlement, chargebacks, cancellation fees, or provider-backed rental payment as implemented. Security bonds, customer-damage settlement, and late-return settlement use separate append-only evidence streams.

See [rental-payment-foundation.md](./rental-payment-foundation.md).

## Cancellation

A confirmed booking can be cancelled only before physical pickup, by authorized staff, after current payment settlement reconciles to zero. Cancellation is terminal. It retains immutable booking/allocation/reschedule/substitution/payment evidence while making the retained allocation non-blocking for new inventory authority.

Cancellation does not itself refund money or perform provider actions. If real money was previously recorded, authorized staff must record the real refund through the payment workflow first. A database guard rejects cancellation once pickup evidence exists.

See [rental-booking-cancellation.md](./rental-booking-cancellation.md).

## Fulfillment and custody

Pickup/return are append-only physical-custody evidence. Pickup snapshots the current effective physical unit and effective committed dates after any supported pre-pickup reschedule/substitution. Pickup is allowed only within the current committed local-date pickup window derived from PostgreSQL time and the retained location timezone.

Pickup is the custody handoff boundary. Cancellation, physical-unit replacement, and arbitrary date moves fail closed after pickup. While custody remains open, authorized staff may still use the separate narrow same-unit price-neutral extension contract described above. Return closes that date-change exception and records immutable custody handback evidence.

If pickup never occurs and the exclusive effective end date is reached, the booking is surfaced as **Missed pickup**. The system does not automatically cancel, refund, fee, or extend it.

If pickup exists and the exclusive effective end is reached without return, the current effective unit becomes **Overdue custody** and is excluded from new inventory authority. Authorized staff can record return or, where still eligible, explicitly review the narrow custody extension. Overdue state itself does not create a fee or mutate the booking.

Return by itself does not shorten the live allocation. When a real early return leaves complete future rental days, authorized staff may explicitly create append-only early-return release evidence and shorten only `RentalBookingAllocation.endsOn`, keeping committed commercial/custody evidence unchanged.

See [rental-booking-fulfillment-foundation.md](./rental-booking-fulfillment-foundation.md), [rental-overdue-custody-availability.md](./rental-overdue-custody-availability.md), and [rental-early-return-inventory-release.md](./rental-early-return-inventory-release.md).

## Operational availability and maintenance

Physical inventory archive lifecycle is distinct from operational serviceability. `RentalUnitOperationalState` retains `AVAILABLE` or `OUT_OF_SERVICE` evidence under tenant/inventory authorization. Live maintenance or non-clear return-condition evidence prevents unsafe return to service.

Maintenance work orders retain `OPEN -> IN_PROGRESS -> COMPLETED/CANCELLED` evidence. Opening maintenance quarantines an available unit. Completion/cancellation does not automatically declare the unit ready; staff must explicitly verify readiness after all active maintenance is terminal.

See [rental-unit-operational-availability.md](./rental-unit-operational-availability.md) and [rental-maintenance-work-orders.md](./rental-maintenance-work-orders.md).

## Return inspection, damage, and customer liability

After return, SF may retain one append-only `CLEAR`, `DAMAGE_REPORTED`, or `UNSAFE` inspection. Damage/unsafe outcomes quarantine an available unit out of service. This operational condition does not itself establish customer liability or move money.

A non-clear inspection may feed one damage case with retained assessment/repair-cost evidence. Once that case is assessed and closed, staff may retain one append-only customer-liability decision: `CUSTOMER_LIABLE` or `NO_CUSTOMER_LIABILITY`. A customer-liable amount must be exact, positive, in booking currency, and cannot exceed retained repair-cost authority.

A customer-liable decision can then be settled only through the currently supported exact full-value manual/offline damage payment/refund workflow or, when an exact-match collected security bond exists, through append-only bond forfeiture. The accepted booking price is never rewritten.

See [rental-return-inspection.md](./rental-return-inspection.md), [rental-damage-case.md](./rental-damage-case.md), [rental-damage-liability.md](./rental-damage-liability.md), and [rental-damage-settlement.md](./rental-damage-settlement.md).

## Security bonds

Security-bond evidence is separate from booking-price payment evidence. A booking may retain a bond requirement, real manual/offline collection/release evidence, and exact-match forfeiture against customer damage liability. The database enforces tenant-composite booking relationships and terminal disposition integrity so a collected bond cannot be both released and forfeited.

Partial offsets, undersecured allocations, excess-bond remainders, split tenders, provider-backed bond settlement, and automatic authorization/capture are deliberately unsupported.

See [rental-security-bond.md](./rental-security-bond.md).

## Late-return policy, assessment, and settlement

After a real return, if retained custody proves the unit came back after the effective exclusive committed end, SF resolves the latest unit-type late-return policy revision that was already effective at the immutable return timestamp. When that revision is enabled, grace days and daily fee authority come from retained policy evidence, the exact chargeable-day math is derived server-side, and PostgreSQL independently rejects browser overrides or mismatched totals. Later policy changes are non-retroactive.

Staff still retain an explicit `FEE_ASSESSED` or `WAIVED` assessment with a required reason. When no enabled revision applied at return, the case-specific manual grace and fee path remains available rather than inventing retroactive policy authority.

An assessed exact fee can feed one separate full-value manual/offline payment/refund settlement boundary. Policy calculation itself does not charge a provider, debit a bond, send an invoice, or mutate the accepted rental price.

See [rental-late-return-policy.md](./rental-late-return-policy.md), [rental-late-return-assessment.md](./rental-late-return-assessment.md), and [rental-late-return-settlement.md](./rental-late-return-settlement.md).

## Database integrity highlights

Current migrations enforce, among other safeguards:

- tenant-composite foreign keys for booking roots and commercial evidence
- immutable booking-time customer/commercial/physical evidence
- one durable booking per source hold
- append-only reschedule, substitution, fulfillment, early-return release, operational, maintenance, inspection/damage/liability, bond, late-return policy, late-return assessment, and settlement evidence where applicable
- exact current effective allocation validation
- booking/unit advisory serialization for compatible writer boundaries
- unavailable-block/effective-hold/other-booking/overdue-custody conflicts
- cancellation only before pickup and only after booking-price settlement reconciles to zero
- substitution only before pickup and before missed-pickup closure
- custody-aware reschedule rules: pre-pickup price-neutral date moves or, after pickup, only current-start/later-end price-neutral extension; no new date changes after return
- pickup/return ordering and pickup-window authority
- operational availability and active-maintenance safety
- effective-at-return late-fee policy selection, exact policy-derived grace/daily-fee authority, and non-retroactive assessment evidence
- cross-ledger manual reference isolation where settlement ledgers share real-world reference authority

Database guards are defense in depth and do not replace application authorization or tenant scoping.

## Customer retention

Booking-time customer name/contact is immutable evidence. The linked mutable customer profile may later change or be archived without rewriting the booking snapshot. Customer de-identification treats hospitality and rental bookings, including cancelled rental bookings, as retention boundaries.

## Deliberate boundaries

The current implementation must not be represented as supporting:

- customer-facing rental checkout, payment, or self-service booking management
- unit-type changes or location-changing substitutions
- price-changing or broader rental amendments/extensions, proration, partial/split adjustment, or automatic extension charging
- online/card/provider-backed rental booking-price, damage, security-bond, or late-fee settlement
- automatic damage liability
- delivery, transfer routing, one-way returns, opening-hour promises, or location-specific customer pickup selection
- external fleet/calendar/marketplace synchronization
- automatic customer notifications
- richer vendor/parts/labor/purchase-order/actual-cost maintenance beyond the retained work-order/damage evidence now implemented

These require separate acceptance criteria, commercial authority, and adapter-backed provider behavior where external systems are involved.

## Validation

Focused domain and source-contract tests protect confirmation authority, same-unit reschedule/custody-extension authority, substitution, cancellation, multi-source partial/full manual booking-price settlement and source-attributed refunds, pickup/return, pickup-window and missed-pickup behavior, overdue custody, early-return release, operational availability/maintenance, inspection/damage/liability, security bonds, late-return policy/assessment/settlement, tenant isolation, database guard intent, server-derived idempotency, immutable booking evidence, and staff route/UI wiring.

The custody-extension work is specifically covered by:

- `src/server/bookings/rental-booking-reschedule-domain.test.ts`
- `scripts/rental-booking-reschedule-source-contract.test.mjs`
- `scripts/rental-booking-pre-custody-writer-source-contract.test.mjs`
- `scripts/rental-booking-fulfillment-source-contract.test.mjs`

The automatic late-return policy is specifically covered by:

- `src/server/pricing/rental-late-return-policy-domain.test.ts`
- `src/server/bookings/rental-late-return-domain.test.ts`
- `scripts/rental-late-return-policy-source-contract.test.mjs`
- `scripts/rental-late-return-policy-followup-source-contract.test.mjs`

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Prisma generation/validation, migration/drift checks, and live PostgreSQL trigger scenarios must target the repository-supported runtime and an explicitly disposable database. GitHub Actions are not required or used.
