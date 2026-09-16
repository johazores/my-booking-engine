# Rental unit operational availability

Rental operational availability is separate from the rental unit lifecycle. `RentalUnit.status` still represents active versus archived inventory; `RentalUnitOperationalState.status` represents whether an active physical unit can currently accept fresh rental work.

## State model

- `AVAILABLE` means the unit can participate in fresh availability, holds, booking confirmation, allocation, substitution, rescheduling, and pickup when every other rule also passes.
- `OUT_OF_SERVICE` is an unbounded operational block. It requires a retained reason of at most 500 characters.
- A missing state row is treated as `AVAILABLE` for backward compatibility with rental units created before the operational-state model was introduced.
- Returning a unit to `AVAILABLE` clears the retained reason.

The state row uses the same `(organizationId, unitId)` ownership boundary as the rental inventory model. PostgreSQL authors `changedAt` with `clock_timestamp()`, prevents the state identity from being rewritten, and prevents the state row from being deleted to bypass the outage.

## Authorization and locking

Reading the state requires `inventory:read`. Changing it requires `inventory:manage`. The service validates organization, actor, and unit UUIDs before database access and repeats `organizationId` on the unit and state reads/writes.

The mutation uses the existing rental physical-unit advisory lock. That is the same lock namespace used by holds, booking allocation, substitution, reschedule, fulfillment, early-return release, and maintenance, so an operational-state transition serializes with competing inventory work.

## Booking and availability enforcement

An out-of-service unit is excluded from fresh availability. PostgreSQL independently rejects attempts to create or retarget:

- an active rental hold;
- a new rental booking;
- a booking allocation;
- a physical-unit substitution target;
- a reschedule on the effective unit; or
- pickup custody evidence.

A return remains allowed if the unit is marked out of service while it is already with a customer. Existing bookings are deliberately not automatically cancelled, refunded, extended, or moved when an outage is recorded.

## Maintenance integration

Rental maintenance work orders now use this operational state as their physical availability authority. Opening maintenance moves an available unit to `OUT_OF_SERVICE` in the same serializable transaction. If the unit already has a retained outage reason, maintenance preserves it. An active `OPEN` or `IN_PROGRESS` work order prevents staff or a direct database update from returning the unit to `AVAILABLE`.

Completing or cancelling maintenance does not automatically clear the outage. Staff must explicitly verify the unit and return it to service after all active maintenance work is terminal. See `docs/rental-maintenance-work-orders.md` for the lifecycle contract.

## Staff UX

The rental-unit detail page shows the current operational state and reason and links to the maintenance workspace. Authorized staff can change the operational state from the unit controls. Attempts to return a unit to service while maintenance remains active surface as a conflict instead of silently weakening the maintenance hold.

## Deliberate boundaries

Operational availability and the maintenance work-order foundation do not implement inspection checklists, damage assessment, security-bond handling, repair-vendor workflows, cost estimates, customer damage charging, late-return fees, notifications, or external maintenance synchronization. Those remain separate Phase 17 commercial workflows.
