# Rental return inspection

SF now records one durable staff return inspection after a rental unit has been returned.

This is a condition-evidence boundary, not a customer damage-charge or security-bond workflow. It intentionally follows immutable `RETURNED` custody evidence so inspection cannot be recorded against an unreturned booking or a caller-selected unit.

## Durable authority

`RentalReturnInspection` is append-only tenant-owned evidence. One booking and one retained return event can each have at most one inspection. The record binds:

- organization and booking;
- the exact immutable `RETURNED` fulfillment event;
- the returned physical unit;
- server-derived organization/booking idempotency;
- outcome (`CLEAR`, `DAMAGE_REPORTED`, or `UNSAFE`);
- retained staff notes;
- PostgreSQL-authored inspection time; and
- the inspecting user.

Damage-reported and unsafe outcomes require notes. Clear inspections may retain optional notes.

PostgreSQL independently verifies that the booking remains confirmed, the referenced fulfillment event is the matching tenant booking's `RETURNED` event for the same unit, and the retained unit is active. Inspection timestamps and creation timestamps are authored with `clock_timestamp()`. Updates and deletes are rejected.

## Authorization and locking

Reading inspection evidence requires `booking:read`.

Recording an inspection requires both `booking:manage` and `inventory:manage`. The writer validates UUID scope before persistence, derives deterministic organization/booking idempotency, serializes it, then acquires the existing physical-unit advisory lock before re-reading authoritative return evidence.

Idempotent replay succeeds only when booking, outcome, and retained notes match the original operation. A booking cannot gain a second inspection under another idempotency key.

## Operational quarantine

A `DAMAGE_REPORTED` or `UNSAFE` inspection is not allowed to leave a currently available unit sellable.

While holding the physical-unit lock, the writer moves an available unit to `OUT_OF_SERVICE` before inserting non-clear inspection evidence. It uses the existing operational-state service so database time and audit behavior stay consistent. If the unit is already out of service, the existing operational reason is preserved instead of being overwritten.

The database trigger independently requires `OUT_OF_SERVICE` for non-clear inspection inserts.

A `CLEAR` inspection does not automatically return a unit to service. An unrelated operational hold or maintenance order may still exist, so returning a unit to `AVAILABLE` remains an explicit inventory-management decision.

## Staff workflow

The rental booking detail shows retained inspection evidence after return. When the booking is returned and no inspection exists, authorized staff get a real `Record return inspection` form with outcome and notes.

This action does not change the booking dates, allocation, accepted money, settlement evidence, return evidence, or early-return release evidence.

## Deliberate boundaries

This foundation does not:

- calculate repair cost or customer liability;
- create a damage claim/case workflow;
- authorize, capture, release, or forfeit a security bond/deposit;
- add photos/files or external assessor/vendor dispatch;
- create maintenance automatically;
- assess late-return fees;
- refund or charge a customer;
- notify customers or external systems.

Those require separate commercial or operational acceptance criteria. The durable inspection evidence and operational quarantine boundary are prerequisites that those later workflows can reference without rewriting custody history.
