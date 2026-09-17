# Rental unit operational availability

SF treats a physical rental unit's commercial lifecycle and operational availability as separate production concerns.

`RentalUnit.status` still answers whether the inventory record is active or archived. `RentalUnitOperationalState.status` answers whether an otherwise active physical unit may accept new rental authority:

- `AVAILABLE` means no operational hold is active.
- `OUT_OF_SERVICE` means the unit is unavailable until authorized staff explicitly returns it to `AVAILABLE`.

A unit without a persisted operational-state row is treated as `AVAILABLE` for backward compatibility. Taking a unit out of service requires a retained reason of at most 500 characters. Returning it to available clears that reason.

## Authorization and tenant scope

Reading operational state requires `inventory:read`. Changing it requires `inventory:manage`.

The service validates organization, actor, and unit identifiers, repeats `organizationId` on unit/state lookups, takes the existing tenant/unit advisory lock, and updates only an active unit owned by the authenticated organization. Every real transition records an `inventory.rental-unit.operational-status-changed` audit event. Repeating the current status and reason is idempotent and does not manufacture another audit event.

PostgreSQL authors `changedAt` with `clock_timestamp()` at the state-row write boundary. The operational-state identity (`organizationId`, `unitId`) is immutable after insertion, and persisted state rows cannot be deleted; returning a unit to service is an explicit `AVAILABLE` transition.

## Availability and lifecycle behavior

`OUT_OF_SERVICE` is an unbounded operational block, not a date-range booking amendment.

Fresh rental availability search excludes out-of-service units before pricing or staff selection. PostgreSQL independently rejects new authority that would place an out-of-service unit into an active rental commitment:

- activating or creating an availability hold;
- inserting a rental booking for the unit;
- inserting an allocation or changing an allocation to that unit;
- inserting a same-unit reschedule while the effective unit is out of service;
- inserting a physical-unit substitution that targets the unit;
- recording `PICKED_UP` custody for the unit.

The database guards deliberately do **not** reject `RETURNED`. A unit may be taken out of service while it is physically in customer custody, and staff must still be able to record its return.

Existing bookings are not silently cancelled, refunded, extended, or moved when staff mark a unit out of service. Supported remediation remains explicit: authorized staff may use the existing pre-custody substitution, reschedule, cancellation, and settlement workflows when their own acceptance criteria permit them.

Unavailable-date blocks remain appropriate for known bounded calendar outages. Operational status is for an indefinite physical-unit outage that ends only through an explicit staff transition.

## Maintenance integration

Rental maintenance work orders use this operational state as their physical availability authority.

Opening a work order requires an active tenant-owned unit and, when the unit is currently available, moves it to `OUT_OF_SERVICE` in the same serializable transaction using the shared tenant/unit advisory lock. The default retained reason is `Maintenance: <title>`. If the unit is already out of service for another retained reason, opening maintenance preserves that reason instead of overwriting it.

PostgreSQL independently requires the unit to be out of service before a maintenance work order can be inserted. Both the application service and the database prevent an `AVAILABLE` transition while any `OPEN` or `IN_PROGRESS` maintenance work remains. PostgreSQL also prevents archiving a unit while active maintenance exists so durable work cannot become orphaned behind an archived inventory record.

Completing or cancelling the final active work order deliberately does **not** return the unit to service automatically. Staff must verify readiness and explicitly use the operational-status control after all active maintenance work is terminal. This prevents a work-order transition from silently clearing another outage or readiness concern.

See `docs/rental-maintenance-work-orders.md` for the work-order lifecycle and evidence contract.

## Return-inspection and damage-case integration

A retained `DAMAGE_REPORTED` or `UNSAFE` return inspection uses the same physical-unit lock and operational-state writer. If the returned unit is currently available, the inspection transaction moves it to `OUT_OF_SERVICE` before inserting inspection evidence. If another operational hold already exists, its reason is preserved.

PostgreSQL independently rejects non-clear return-inspection evidence unless the retained returned unit is already out of service. A clear inspection never changes operational state, and no inspection automatically returns a unit to service.

A non-clear inspection can feed one explicit `RentalDamageCase`. Opening the case again verifies the physical unit is out of service. While the case is `OPEN` or `ASSESSED`, both the application operational-state writer and PostgreSQL reject an `AVAILABLE` transition, and PostgreSQL rejects archiving the unit. `WAIVED` and `CLOSED` are terminal damage-case states.

Waiving or closing the final unresolved damage case deliberately does not return the unit to service. Staff must still verify maintenance and any other operational concerns before explicitly restoring availability.

See `docs/rental-return-inspection.md` and `docs/rental-damage-case.md` for the retained condition and damage-follow-up contracts.

## Staff workflow

The rental-unit detail page shows the current operational status and retained reason. Staff with inventory-management permission can move the unit between **Available** and **Out of service** from the existing unit controls and can open the dedicated maintenance workspace from the same page.

This is a real inventory authority control. It is not a cosmetic label: discovery, maintenance, return inspection, damage follow-up, and database write boundaries consume the state. Attempts to return a unit to service while active maintenance or an unresolved damage case remains fail closed as a conflict.

## Deliberate boundaries

Operational availability, maintenance work orders, return-condition inspection, and damage cases do not invent customer damage liability/charging, security-bond handling, repair-vendor dispatch, purchase orders, parts inventory, detailed labor/cost line items, late-return fees, automatic notifications, or external maintenance-provider synchronization.

The damage-case repair estimate is operational evidence only and is not a customer balance or payment instruction. Customer liability, security bonds, and settlement remain separate Phase 17 commercial workflows with their own policy and authorization requirements.

## Validation

The dependency-free domain test `src/server/inventory/rental-unit-operational-domain.test.ts` protects status/reason normalization. The operational source contract `scripts/rental-unit-operational-availability-source-contract.test.mjs` protects:

- the Prisma enum/model and tenant/unit relation;
- authorization, tenant scope, unit locking, database time, idempotent writes, and audit evidence;
- availability-search exclusion;
- database guards across holds, booking confirmation, allocation/substitution, reschedule, and pickup;
- the explicit ability to record return while a unit is out of service;
- the staff unit-detail control and deliberate commercial boundaries.

The maintenance domain and source-contract tests additionally protect work-order lifecycle validation, tenant-scoped idempotency, shared locking, operational coupling, active-maintenance release protection, archive protection, database-authored lifecycle timestamps, audit evidence, and real staff actions. The return-inspection source contract protects returned-custody binding, dual write permissions, idempotency, database-authored immutable evidence, non-clear operational quarantine, and the real booking-detail action. The damage-case domain and source contract protect non-clear inspection binding, exact estimate evidence, unresolved-case operational release/archive protection, lifecycle immutability, and real staff actions without creating customer settlement behavior.

Repository validation remains `npm run validate` on the Node version declared in `package.json`. Migration and trigger behavior should additionally be exercised through `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
