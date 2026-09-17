# Rental inventory

SF rental inventory is a tenant-owned production foundation for rentable physical inventory. It separates catalog, operating-location, availability-calendar, temporary inventory protection, pricing evidence, rate configuration, durable physical-unit allocation, staff rental booking lifecycle, physical-custody evidence, operational availability, maintenance, post-return condition/damage evidence, security-bond evidence, late-return commercial evidence, and the current narrow manual settlement boundaries. The current booking workflow supports hold-to-booking confirmation, tenant-scoped history/detail, same-unit price-neutral date rescheduling, same-type/same-location physical-unit substitution, terminal pre-pickup inventory-release cancellation, staff-only full-value manual/offline booking-price settlement with remaining refunds, append-only pickup/return custody evidence, overdue open-custody inventory protection, missed-pickup operational visibility, explicit release of complete remaining rental days after return, operational out-of-service/maintenance work orders, return inspection and damage-case follow-up, customer damage-liability authority with exact manual settlement or exact security-bond forfeiture, and explicit late-return assessment with exact manual/offline fee settlement. Online/card or other provider-backed rental settlement, unit-type/location-changing and price-changing amendments/extensions, delivery semantics, automatic tenant late-fee policy, notifications/external synchronization, and customer self-service remain separate contracts.

## Implemented scope

- Rental unit types with tenant-local codes, currency, and a required default daily price in minor units.
- Tenant-owned operating/home locations with tenant-local codes, postal address fields, two-letter country code, IANA timezone, and active/archive lifecycle.
- Individually managed rental units linked to a unit type and active tenant location for newly created units.
- Audited unit relocation between active locations, blocked while the unit has a non-cancelled booking allocation.
- Unit-level unavailable-date blocks using half-open calendar ranges `[startsOn, endsOn)`.
- Unit-type date-range daily price overrides with overlap rejection.
- Read-only availability/pricing preview under `/inventory/rentals/availability`, bounded to 90 days and excluding unavailable blocks, effective holds, overlapping non-cancelled rental booking allocations, and overdue unreturned physical custody.
- Durable temporary availability holds for a specific physical unit/date range, with organization idempotency, 1-30 minute expiry, and `ACTIVE`, `RELEASED`, `EXPIRED`, or `CONSUMED` lifecycle evidence.
- Immutable hold pricing evidence: currency, total minor units, canonical SHA-256 pricing fingerprint, bounded pricing snapshot, and observation time.
- Protected hold management and current-price review.
- Conversion authority that binds an active tenant hold, active tenant customer, current inventory, current pricing, and deterministic authority fingerprint.
- Staff conversion interaction with bounded customer search and confirmation only after fresh authority.
- A durable rental booking writer that consumes the exact hold, snapshots customer/commercial evidence, creates `RentalBooking`, creates exact `RentalBookingAllocation`, and records a secret-free audit event in one serializable transaction.
- Tenant-scoped, paginated rental booking history and detail protected by `booking:read`.
- Same-unit, price-neutral date rescheduling with fresh target inventory/pricing review, versioned authority fingerprint, server-derived idempotency, serializable booking/effective-unit locks, append-only reschedule evidence, exact effective allocation update, stale-authority protection, and audit evidence.
- Same-type, same-location physical-unit substitution with bounded candidate search, fresh target inventory review, version-2 authority fingerprint, deterministic booking/source/target locks, server-derived idempotency, append-only substitution evidence, exact effective allocation-unit move, stale-authority protection, pickup/missed-pickup lifecycle guards, and audit evidence.
- Explicit staff cancellation for a confirmed pre-pickup booking with `booking:manage` plus `availability:manage`. Cancellation records terminal `CANCELLED`, retains historical allocation/reschedule/substitution evidence, and releases live inventory protection only after current rental payment settlement reconciles to zero.
- Staff-only full-value manual/offline payment recording and remaining manual/offline refund recording through the existing payment-provider adapter boundary, with tenant-scoped append-only evidence, server-derived idempotency, booking serialization, bounded complete settlement-history reconciliation, and payment-state cancellation guards.
- Staff pickup/return custody recording with `booking:manage` plus `inventory:manage`, exact effective allocation validation, booking/effective-unit serialization, PostgreSQL event time, server-derived idempotency, immutable unit/date snapshots, append-only evidence, and pickup-before-return ordering.
- Pickup freezes unsafe booking mutations: database guards reject cancellation, rescheduling, and physical-unit substitution after custody has transferred.
- A confirmed awaiting-pickup booking whose exclusive effective end date has been reached in the retained location timezone is surfaced as **Missed pickup**; pickup and physical-unit replacement close under that expired period without inventing cancellation, fees, refunds, or extensions.
- Return records custody handback without automatically shortening or releasing the committed availability period.
- Explicit early-return inventory release after `RETURNED`, using the same booking/inventory permissions, booking/unit lock order, immutable return evidence, retained booking-location timezone, server-derived idempotency, append-only release evidence, and exact whole-day allocation shortening.
- A picked-up unit whose exclusive effective end date has been reached in the retained booking-location timezone remains unavailable for new inventory authority until append-only return evidence exists.
- Rental-unit operational availability is distinct from archive lifecycle: authorized staff can retain `AVAILABLE` or `OUT_OF_SERVICE` state, and active maintenance/non-clear damage evidence prevents unsafe return to service.
- Maintenance work orders retain tenant-scoped `OPEN -> IN_PROGRESS -> COMPLETED/CANCELLED` operational evidence, quarantine affected units, and require explicit readiness verification before a unit returns to `AVAILABLE`.
- Post-return inspection retains one `CLEAR`, `DAMAGE_REPORTED`, or `UNSAFE` outcome per booking. Non-clear outcomes quarantine the returned physical unit and can feed one explicit damage-case lifecycle with retained repair-cost evidence.
- A closed assessed damage case can feed one append-only customer-liability decision and, when liable, one exact full-value manual/offline damage settlement or an exact-match security-bond forfeiture without mutating the accepted booking price.
- Security bonds use separate retained requirement, collection/release, and exact-match forfeiture evidence; partial offsets and provider-backed bond settlement are intentionally unsupported.
- Returned late bookings can retain one explicit `FEE_ASSESSED` or `WAIVED` decision with staff-entered grace days and exact fee authority; assessed fees can then retain one exact full-value manual/offline payment and refund without pretending an automatic policy or provider charge exists.
- Confirmed rental allocations participate in availability, hold creation, unavailable-date blocks, substitution, and unit mutation guards. Cancelled parent bookings make retained allocations non-blocking; early-return release shortens only the live allocation end while preserving committed booking evidence.
- Customer de-identification treats hospitality and rental booking references, including cancelled rental bookings, as retention boundaries.
- Server-side authorization for inventory, availability, pricing, booking, customer, payment, and fulfillment capabilities used by each workflow.
- Tenant-scoped reads and mutations; resource identifiers, idempotency keys, codes, hold IDs, customer IDs, booking IDs, target-unit IDs, authority fingerprints, and payment references never grant scope without authenticated `organizationId`.
- Database-enforced tenant roots, organization-composite relationships, booking insert guards, immutable booking-time evidence, append-only reschedule/substitution/payment/fulfillment/early-return-release evidence, effective-allocation guards, terminal cancellation and financial-settlement guards, custody-order, pickup-window, missed-pickup substitution, and overdue-custody guards, per-unit advisory serialization, and deferred exact-allocation validation.
- Archive lifecycle for commercial inventory rows with dependency-safe constraints.
- Database pricing-evidence invariants that allow legacy holds without evidence but reject partially populated or invalid evidence.
- Explicit destructive confirmations for inventory removal/archive and booking cancellation.
- Audit events for inventory, hold, booking confirmation, booking reschedule, booking unit substitution, booking cancellation, rental manual payment/refund recording, pickup, return, and early-return inventory release.
- Independently bounded pagination for rental management collections and bounded cursor pagination for complete rental payment reconciliation history.
- Real inventory UI under `/inventory/rentals` with unit-type, location, unit, availability, hold, conversion, booking list/detail, reschedule, unit-substitution, cancellation, manual settlement, pickup, return, and post-return inventory-release surfaces.

## Location semantics

A rental location is inventory metadata representing the current operating/home location of physical stock. It does not by itself promise customer pickup/drop-off availability.

Location codes are canonical tenant-local identifiers. Unit creation and relocation resolve locations server-side inside the authenticated organization. A location cannot be archived while an active unit depends on it. A unit with a non-cancelled booking allocation cannot be relocated, archived, or retyped; staff must first use a supported booking lifecycle operation such as same-location substitution or pre-pickup cancellation.

Customer pickup/drop-off location selection, one-way returns, delivery zones, transfer fees, opening hours, location-specific taxes, and related booking terms require separate acceptance criteria. The implemented pickup event records custody of the already assigned effective unit; it does not choose or promise a customer-facing pickup location.

## Date, hold, pricing, and booking semantics

Calendar records are PostgreSQL `DATE` values with an exclusive end. A range from `2026-10-01` through `2026-10-04` covers October 1, 2, and 3.

Pricing uses integer minor units. A unit type owns its currency; rate periods override the daily amount for a date range without introducing another currency.

### Availability and pricing preview

The preview resolves active tenant inventory and rejects unavailable blocks, effective `ACTIVE` holds, overlapping non-cancelled rental allocations, and physical units whose picked-up custody is overdue and has not been returned. Results are bounded to 90 days.

Overdue custody uses PostgreSQL time plus the retained booking location's IANA timezone. A unit remains eligible for later reservations while the current pickup is still inside its committed period; it becomes unavailable only once the exclusive effective end date is reached without return evidence. See [rental-overdue-custody-availability.md](./rental-overdue-custody-availability.md).

Pricing is deterministic from default daily rate plus rate-period overrides. A canonical fingerprint binds unit type, currency, dates, exact total, and segmented rate sources so later authority can compare immutable evidence with current configuration.

### Holds and booking conversion

Roles with `availability:manage` may turn a current availability result into a short-lived hold. Hold creation revalidates the unit, location, blocks, effective holds, non-cancelled booking allocations, overdue open custody, and current pricing under the shared physical-unit serialization boundary.

Every new hold snapshots pricing evidence. A hold is not a customer booking or payment authority.

The staff conversion workflow binds an active tenant customer. `confirmRentalBookingFromHold` revalidates customer, effective hold, physical-unit state, current price, allocation conflicts, overdue open custody, and authority fingerprint under serializable locks. It consumes the hold and creates booking/allocation atomically.

`CONFIRMED` means SF has committed physical inventory under reviewed commercial evidence. It does not mean money was collected, a deposit was authorized, or custody was transferred.

### Same-unit price-neutral rescheduling

Authorized staff may review a new date range for the current effective confirmed physical unit before pickup. Review requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`; apply additionally requires `availability:manage`.

Review and apply use the current effective allocation after any supported unit substitution rather than assuming immutable booking-time unit/date evidence is still operational authority. Target dates are rejected when they overlap an unavailable block, effective hold, another non-cancelled booking, or another overdue open-custody booking that still physically retains the unit. Target pricing must preserve accepted currency and exact aggregate amount.

Apply reacquires tenant/booking and effective physical-unit locks, rebuilds authority, derives idempotency server-side, inserts append-only `rental_booking_reschedules` evidence, moves only effective allocation dates, advances booking version, and records audit evidence. Database guards reject new reschedules once pickup evidence exists and reject allocation writes onto physical units still retained by overdue open custody.

See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

### Same-type same-location physical-unit substitution

Authorized staff may replace the current effective unit with another active unit under the same retained product/type and operating location while dates and accepted money remain unchanged, before pickup custody is recorded, and before the exclusive effective rental end has been reached.

Candidate discovery is bounded and does not reserve inventory. Fresh review uses PostgreSQL time plus the retained booking-location timezone to reject a booking once its pickup window has closed, then checks target blocks, effective holds, other non-cancelled allocations, overdue open custody, wrong tenant/type/location, inactive lifecycle, and no-op targets. The version-2 authority fingerprint binds booking version, current source, target, retained type/location, effective dates, exact accepted money, and effective pricing evidence.

Apply reacquires the booking lock and both physical-unit locks in deterministic order, rechecks that no fulfillment evidence exists, re-derives the current pickup window from PostgreSQL time and the retained location timezone, rebuilds authority, inserts append-only substitution evidence, moves only `RentalBookingAllocation.unitId`, advances the booking version, and records audit evidence. Original `RentalBooking.unitId` remains immutable booking-time history. Database guards reject new substitutions once pickup evidence exists, after the missed-pickup exclusive-end boundary, and when a target remains held by overdue open custody.

Database guards derive the effective unit from latest substitution history for allocation, reschedule, cancellation, and fulfillment authority. See [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md) and [rental-booking-pickup-window.md](./rental-booking-pickup-window.md).

### Manual/offline settlement

A confirmed rental booking may receive one full-value manual/offline payment recorded by authorized staff after the real external settlement has occurred. The browser provides only the normalized external reference; tenant, actor, booking, idempotency, currency, and amount authority are server-derived.

A later manual/offline refund records the remaining refundable amount against the successful source payment and retains explicit source attribution. Settlement decisions load complete tenant-owned history through bounded cursor pages and fail closed if the current reconciliation safety limit is exceeded.

Payment evidence is append-only and separate from booking/inventory/fulfillment evidence. This booking-price workflow does not implement card authorization, Stripe rental checkout, split tenders, cancellation fees, chargebacks, customer self-service, or pickup/return-specific settlement rules. Security bonds, customer-damage settlement, and late-return settlement use their own retained evidence streams. See [rental-payment-foundation.md](./rental-payment-foundation.md).

### Cancellation

Staff cancellation changes only a still-confirmed pre-pickup tenant booking to terminal `CANCELLED` under booking/current-effective-unit serialization. Cancellation validates current allocation after latest reschedule and substitution, requires complete rental payment settlement to reconcile to zero, retains booking/allocation/modification/payment history, and makes retained allocation non-blocking for live inventory.

Cancellation does not itself perform a refund, deposit, provider, tax, notification, or fulfillment action. Any real manual refund must be recorded through the payment workflow before cancellation can commit. Once pickup custody exists, a database guard rejects cancellation. See [rental-booking-cancellation.md](./rental-booking-cancellation.md), [rental-payment-foundation.md](./rental-payment-foundation.md), and [rental-booking-fulfillment-foundation.md](./rental-booking-fulfillment-foundation.md).

### Pickup, missed pickup, return, and early-return inventory release

Authorized staff may record pickup only for a confirmed booking whose current effective allocation is intact and whose committed local-date window is active. The writer requires `booking:manage` and `inventory:manage`, takes the tenant/booking lock followed by the effective physical-unit lock, resolves latest reschedule/substitution authority, snapshots the active effective unit and committed dates, derives idempotency server-side, and uses PostgreSQL time plus the retained booking-location timezone.

Pickup is the physical-custody handoff boundary. From that point, database guards reject cancellation, rescheduling, and unit substitution so historical custody evidence cannot be contradicted by a later booking mutation.

If the exclusive committed end is reached while the booking is still awaiting pickup, SF surfaces **Missed pickup**. Pickup and physical-unit replacement are closed for that expired period. This does not automatically cancel, refund, extend, or fee the booking; separately authorized reschedule/cancellation paths remain the remediation boundary.

Return requires prior pickup and records a second append-only custody event for the same effective assignment. Return does not automatically release inventory early.

After `RETURNED`, staff with the same booking/inventory management permissions may explicitly release remaining inventory only when at least one complete rental day remains. The release cutoff is the later of the day after the return in the retained booking-location timezone or the day after the committed start. The customer/commercial committed end stays unchanged; only `RentalBookingAllocation.endsOn` shortens, backed by append-only release evidence and database guards.

If return has not been recorded when the exclusive committed end date is reached in the retained booking-location timezone, the physical unit becomes overdue open custody and is excluded from new availability, hold, conversion, reschedule-target, and replacement-unit authority until return is recorded. This does not itself create an extension or fee. After real return evidence exists, the separate late-return assessment may retain `FEE_ASSESSED` or `WAIVED` authority and an assessed fee may later retain exact manual/offline settlement evidence.

Rental extensions/price-changing amendments, delivery semantics, automatic tenant late-fee policy, partial/provider-backed rental settlement, customer self-service, fulfillment notifications, and external synchronization remain separate contracts.

See [rental-booking-fulfillment-foundation.md](./rental-booking-fulfillment-foundation.md), [rental-booking-pickup-window.md](./rental-booking-pickup-window.md), [rental-early-return-inventory-release.md](./rental-early-return-inventory-release.md), [rental-overdue-custody-availability.md](./rental-overdue-custody-availability.md), [rental-unit-operational-availability.md](./rental-unit-operational-availability.md), [rental-maintenance-work-orders.md](./rental-maintenance-work-orders.md), [rental-return-inspection.md](./rental-return-inspection.md), [rental-damage-case.md](./rental-damage-case.md), [rental-damage-liability.md](./rental-damage-liability.md), [rental-damage-settlement.md](./rental-damage-settlement.md), [rental-security-bond.md](./rental-security-bond.md), [rental-late-return-assessment.md](./rental-late-return-assessment.md), and [rental-late-return-settlement.md](./rental-late-return-settlement.md).

### Hold expiry

Expiry remains authoritative by timestamp: an `ACTIVE` hold whose `expiresAt` is no longer in the future stops protecting availability even before lifecycle cleanup changes its stored status. Explicit release changes an effective hold to `RELEASED`; releasing an already expired active row records `EXPIRED`; successful booking conversion changes the hold to `CONSUMED`.

## Deliberate boundaries

The following are **not** presented as implemented:

- customer-facing rental search, checkout, payment, or self-service booking management
- unit-type changes, location-changing substitutions, and price-changing rental amendments or rescheduling
- general unit substitution and price-changing rental amendments beyond the supported same-type/same-location and price-neutral boundaries
- online rental checkout/card authorization, partial/split/provider-backed booking-price, damage, bond, or late-fee settlement, cancellation fees, discounts, taxes/fees beyond retained explicit authorities, or complex pricing beyond current daily-rate evidence
- customer pickup/drop-off location selection, one-way return policy, delivery zones, opening-hour rules, or transfer pricing
- rental extensions/price-changing amendments, automatic tenant late-fee policy, delivery semantics, customer self-service, or fulfillment notifications
- quantity pools for interchangeable stock
- hourly rentals
- richer maintenance vendor dispatch, purchase-order, parts, labor, and actual-cost workflows beyond the current work-order lifecycle
- external marketplace, fleet, supplier, or calendar synchronization

Those require separate commercial state machines and acceptance criteria. The current production contract includes staff-reviewed durable inventory commitment, tenant-scoped read history, price-neutral date rescheduling, same-type/same-location physical-unit substitution within the pre-custody committed window, pre-pickup inventory-release cancellation, narrow staff-only manual/offline booking settlement/refund evidence, append-only pickup/return custody evidence, missed-pickup operational visibility, overdue open-custody inventory protection, explicit whole-day post-return inventory release, operational availability and maintenance work orders, return inspection/damage-case/customer-liability evidence, security-bond requirement/collection/release/exact forfeiture, and explicit late-return assessment plus exact manual/offline fee settlement.

## Validation boundary

Dependency-free domain/source contracts cover deterministic pricing and authority fingerprints, tenant-composite relationships, database guards, hold evidence, authorization, tenant-bound resolution, bounded collections, overlap behavior, atomic hold consumption, durable booking/allocation persistence, reschedule/substitution authority and write scope, missed-pickup substitution closure, cancellation, rental manual settlement/refund evidence, bounded complete settlement history, pickup/return state ordering and neighboring-mutation freeze, overdue open-custody availability protection, early-return inventory release, operational availability/maintenance, return inspection/damage/liability, security bonds/forfeiture, late-return assessment/settlement, direct commercial booking referential integrity, customer retention, and the no-fake-commercial-workflow boundary.

`scripts/rental-unit-substitution-pickup-window-source-contract.test.mjs` specifically protects the candidate/review/write pickup-window checks, PostgreSQL direct-write guard, and staff action closure after missed pickup.

Guarded PostgreSQL scenarios remain registered under `npm run test:database` and must target an explicitly disposable database. Live Prisma validation, migration/drift checks, complete typecheck/lint/test/build, and PostgreSQL execution must not be claimed without the repository-supported Node 24 toolchain and required environment.

GitHub Actions are intentionally not required or used.
