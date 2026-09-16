# Rental maintenance work orders

Rental maintenance is a durable Phase 17 operational workflow for a physical rental unit. It is intentionally separate from lifecycle archiving, booking inventory blocks, customer custody, and commercial settlement.

## Authority and tenant scope

- Reading maintenance history requires `inventory:read`.
- Opening, starting, completing, and cancelling maintenance requires `inventory:manage`.
- Organization, actor, unit, and work-order UUIDs are validated before persistence access.
- Every unit and work-order read repeats `organizationId`; work orders cannot be transitioned through another tenant or another unit URL.
- Unit-scoped writes use the same rental-unit advisory lock namespace as availability, allocation, substitution, fulfillment, and operational-state writes.
- Work-order creation also serializes the organization-scoped idempotency key before the unit lock, so concurrent duplicate submissions cannot bind one key to different work.

## Lifecycle

A work order starts `OPEN` and may move forward to:

- `IN_PROGRESS`, then `COMPLETED` or `CANCELLED`;
- directly to `COMPLETED` for immediately resolved work; or
- directly to `CANCELLED` when the work order should not proceed.

`COMPLETED` and `CANCELLED` are terminal. Completion notes are optional retained evidence. Cancellation requires a retained reason. The service treats an exact replay of the already-recorded target state as idempotent and rejects a replay with different terminal evidence.

PostgreSQL authors `openedAt`, `startedAt`, `completedAt`, `cancelledAt`, `createdAt`, and `updatedAt` using `clock_timestamp()`. The database trigger rejects caller-authored lifecycle evidence, backward transitions, terminal edits, source-evidence rewrites, and deletion of work-order history.

## Operational availability coupling

Opening a work order requires an active tenant-owned unit and makes the unit `OUT_OF_SERVICE` in the same serializable transaction when it was previously available. The operational reason becomes `Maintenance: <title>`. If the unit is already out of service for another retained reason, maintenance preserves that reason instead of overwriting it.

The database independently requires the unit to be out of service before a new maintenance row can be inserted. Both the application service and PostgreSQL prevent a unit from being returned to `AVAILABLE` while any `OPEN` or `IN_PROGRESS` maintenance work remains.

Completing or cancelling the final active work order does **not** automatically return the unit to service. Staff must explicitly verify the unit and use the existing operational-status control. This prevents a completed administrative record from silently overriding another outage or readiness concern.

Multiple active work orders are allowed for one unit. The unit stays unavailable until all active work is terminal and staff explicitly returns it to service.

## Booking behavior

Maintenance does not rewrite existing commercial commitments. Opening work does not automatically cancel, refund, reschedule, extend, or substitute an existing booking. The existing operational-availability authority continues to reject new holds, confirmations, allocations, substitutions, reschedules, and pickups for an out-of-service unit while still allowing a customer return already in custody.

## Staff workflow

The rental-unit page links to a dedicated maintenance workspace. The workspace provides:

- paginated durable work-order history;
- an authorized create form with a stable per-render idempotency key;
- explicit start, complete, and cancel actions for active work;
- retained descriptions, completion notes, and cancellation reasons; and
- clear unit operational-state guidance before returning a repaired unit to service.

Mutation routes use the existing same-origin authenticated form boundary and request observability used by inventory operations.

## Audit evidence

Opening a work order records `inventory.rental-maintenance.work-order-opened`. Lifecycle changes record `inventory.rental-maintenance.work-order-status-changed`. Operational state changes continue to use `inventory.rental-unit.operational-status-changed`. Audit payloads retain identifiers, state, unit code, title, and database-authored timestamps without introducing credentials or customer data.

## Deliberate boundaries

This foundation does not invent inspection checklists, damage assessment, security-bond decisions, repair-vendor dispatch, purchase orders, parts inventory, labor/cost estimates, customer damage charging, late-return fees, notifications, or external maintenance-provider synchronization. Those require separate commercial evidence and policy contracts.
