# Rental unit operational availability

SF now treats a physical rental unit's commercial lifecycle and its operational availability as separate production concerns.

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

## Staff workflow

The rental-unit detail page shows the current operational status and retained reason. Staff with inventory-management permission can move the unit between **Available** and **Out of service** from the existing unit controls.

This is a real inventory authority control. It is not a cosmetic label: discovery and database write boundaries both consume the state.

## Deliberate boundaries

This foundation does not invent a maintenance work-order system, inspection checklist, damage assessment, security-bond flow, repair vendor workflow, cost estimate, late-return fee, or automatic customer notification.

Those remain separate Phase 17 commercial workflows. A future inspection or maintenance workflow can transition the same operational state once its own evidence and authorization contract is defined, without weakening the current availability boundary.

## Validation

The dependency-free domain test `src/server/inventory/rental-unit-operational-domain.test.ts` protects status/reason normalization. The source contract `scripts/rental-unit-operational-availability-source-contract.test.mjs` protects:

- the Prisma enum/model and tenant/unit relation;
- authorization, tenant scope, unit locking, database time, idempotent writes, and audit evidence;
- availability-search exclusion;
- database guards across holds, booking confirmation, allocation/substitution, reschedule, and pickup;
- the explicit ability to record return while a unit is out of service;
- the staff unit-detail control and deliberate commercial boundaries.

Repository validation remains `npm run validate` on the Node version declared in `package.json`. Migration and trigger behavior should additionally be exercised through `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
