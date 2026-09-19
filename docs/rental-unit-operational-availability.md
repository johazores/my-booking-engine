# Rental unit operational availability

SF treats a physical rental unit's commercial lifecycle and operational availability as separate production concerns.

`RentalUnit.status` answers whether the inventory record is active or archived. `RentalUnitOperationalState.status` answers whether an otherwise active physical unit may accept new rental authority:

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
- inserting a physical-unit substitution that targets the unit; and
- recording `PICKED_UP` custody for the unit.

The database guards deliberately do **not** reject `RETURNED`. A unit may already be out of service while it is physically in customer custody, and staff must still be able to record its return.

Existing bookings are not silently cancelled, refunded, extended, or moved when staff mark a unit out of service. Supported remediation remains explicit: authorized staff may use the existing pre-custody substitution, reschedule, cancellation, and settlement workflows when their own acceptance criteria permit them.

Unavailable-date blocks remain appropriate for known bounded calendar outages. Operational status is for an indefinite physical-unit outage that ends only through an explicit staff transition.

## Returned-unit readiness

Recording `RETURNED` now closes the availability gap between physical handback and the mandatory return-condition inspection. Under the existing tenant/unit lock, the supported fulfillment writer moves an otherwise available unit to `OUT_OF_SERVICE` with the retained reason `Returned unit awaiting operational readiness review` before it commits the return event. If maintenance or another operational concern already has the unit out of service, that existing reason is preserved.

An idempotent return replay also repairs older supported return evidence that still lacks an inspection and operational quarantine. It does not re-quarantine a returned unit after inspection evidence already exists.

A unit cannot be explicitly returned to `AVAILABLE` while any tenant-owned `RETURNED` event for that physical unit still lacks its matching `RentalReturnInspection`. A non-clear inspection remains unavailable until its matching damage case reaches `WAIVED` or `CLOSED`; this closes the safety gap between retaining `DAMAGE_REPORTED` / `UNSAFE` evidence and opening the damage case that resolves it. The application checks both conditions while holding the unit lock before an available transition. Active maintenance and active damage cases remain independent blockers.

PostgreSQL independently uses the same tenant/unit advisory lock. The active-rental authority predicate treats pending return inspection and unresolved non-clear return evidence as unavailable in addition to persisted `OUT_OF_SERVICE` state, so direct SQL cannot create a hold, booking/allocation, substitution, reschedule, or pickup against a returned unit whose physical readiness is unresolved. The existing operational-state trigger is also strengthened so a direct `AVAILABLE` transition fails both before inspection and after a non-clear inspection until matching damage evidence is terminal.

This defense-in-depth matters for early return. Shortening a returned booking's allocation may release future calendar days, but those days do not become sellable until return inspection is retained, any non-clear condition is resolved through its damage case, and authorized staff explicitly restore operational availability.

## Maintenance integration

Rental maintenance work orders use this operational state as their physical availability authority.

Opening a work order requires an active tenant-owned unit and, when the unit is currently available, moves it to `OUT_OF_SERVICE` in the same serializable transaction using the shared tenant/unit advisory lock. The default retained reason is `Maintenance: <title>`. If the unit is already out of service for another retained reason, opening maintenance preserves that reason instead of overwriting it.

PostgreSQL independently requires the unit to be out of service before a maintenance work order can be inserted. Both the application service and the database prevent an `AVAILABLE` transition while any `OPEN` or `IN_PROGRESS` maintenance work remains. PostgreSQL also prevents archiving a unit while active maintenance exists so durable work cannot become orphaned behind an archived inventory record.

Completing or cancelling the final active work order deliberately does **not** return the unit to service automatically. Staff must verify readiness and explicitly use the operational-status control after all active maintenance work is terminal. This prevents a work-order transition from silently clearing another outage or readiness concern.

See `docs/rental-maintenance-work-orders.md` for the work-order lifecycle and evidence contract.

## Return-inspection, damage-case, and liability integration

Every supported return is operationally quarantined until inspection and explicit readiness release. A retained `DAMAGE_REPORTED` or `UNSAFE` inspection additionally establishes non-clear condition evidence. If another operational hold already exists, its reason is preserved.

PostgreSQL independently requires an out-of-service unit for non-clear return-inspection evidence. A clear inspection never changes operational state and no inspection automatically returns a unit to service. This keeps release deliberate after the physical readiness review.

A non-clear inspection can feed one explicit `RentalDamageCase`, but the unit remains unavailable even before that case is opened. The application and PostgreSQL treat non-clear inspection evidence as unresolved until a matching damage case reaches terminal `WAIVED` or `CLOSED`. While the case is `OPEN` or `ASSESSED`, the existing damage-case guards continue to reject an `AVAILABLE` transition and archival.

Waiving or closing the final unresolved damage case deliberately does not return the unit to service. Staff must still verify maintenance and any other operational concerns before explicitly restoring availability.

A customer-damage-liability decision is downstream commercial evidence only after a damage case is closed. It does not itself quarantine or release the unit, so operational readiness remains governed by return inspection, non-clear damage resolution, maintenance, and the explicit operational control rather than by customer settlement status.

See `docs/rental-return-inspection.md`, `docs/rental-damage-case.md`, and `docs/rental-damage-liability.md` for those contracts.

## Staff workflow

The rental-unit detail page shows the current operational status and retained reason. Staff with inventory-management permission can move the unit between **Available** and **Out of service** from the existing unit controls and can open the dedicated maintenance workspace from the same page.

This is real inventory authority, not a cosmetic label. Discovery, fulfillment, maintenance, return inspection, damage follow-up, and database write boundaries consume the state. Attempts to return a unit to service while return inspection is pending, a non-clear return condition remains unresolved, maintenance is active, or a damage case remains unresolved fail closed as inventory conflicts.

## Deliberate boundaries

Operational availability, maintenance work orders, return-condition inspection, and damage cases do not themselves invent customer charging, security-bond handling, repair-vendor dispatch, purchase orders, parts inventory, detailed labor/cost line items, late-return fees, automatic notifications, or external maintenance-provider synchronization.

The damage-case repair estimate is operational evidence only and is not a customer balance or payment instruction by itself. A separate post-closure customer-liability decision can retain whether and how much of that estimate is attributed to the customer. Security bonds and damage settlement/collection remain separate Phase 17 commercial workflows with their own policy, provider, reconciliation, and authorization requirements.

## Validation

The dependency-free domain test `src/server/inventory/rental-unit-operational-domain.test.ts` protects status/reason normalization. `scripts/rental-unit-operational-availability-source-contract.test.mjs` protects the established operational-state model, authorization, locking, search exclusion, active-authority database guards, staff control, and deliberate commercial boundaries.

`scripts/rental-return-readiness-source-contract.test.mjs` protects returned-unit quarantine, idempotent legacy repair, pending-inspection and non-clear-condition release protection, the shared PostgreSQL lock boundary, and the database backstop that rejects fresh rental authority until physical readiness is resolved.

The maintenance, return-inspection, damage-case, and damage-liability source contracts continue protecting their narrower lifecycle and evidence rules.

Repository validation remains `npm run validate` on the Node version declared in `package.json`. Migration and trigger behavior should additionally be exercised through `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
