# Rental pending-return inspection archive authority

A returned physical rental unit must remain active long enough for staff to record its durable return-condition inspection. Return inspection authoring deliberately requires the exact tenant-owned `RETURNED` custody event and an active retained physical unit. Allowing archival between those two steps would make the real return-inspection workflow impossible.

## Supported archive preflight

The archive POST now performs an `inventory:manage`-authorized, tenant-scoped preflight before calling the existing physical-unit archive service. It searches retained `RETURNED` fulfillment events for that exact unit and fails with the existing inventory-conflict response when any return still has no matching `RentalReturnInspection`.

This preflight gives staff an actionable supported-service failure before attempting retirement. It is not the concurrency authority: another transaction could still insert return evidence or inspection evidence after the read, so PostgreSQL remains the final lifecycle boundary.

## PostgreSQL authority

`20260920003000-rental-pending-return-inspection-archive-guard` adds the database backstop. Physical-unit archival already acquires the shared tenant/unit advisory lock before lifecycle guards execute, and return-inspection insertion uses the same lock. After serialization, PostgreSQL rejects an `ACTIVE` → `ARCHIVED` transition when a tenant-owned `RETURNED` fulfillment event for that exact unit has no matching inspection bound to the same organization, return event, and unit.

If inspection authoring wins the lock first, archival waits and then sees the committed inspection. If archival attempts first while inspection evidence is still missing, archival fails and the unit stays active so the inspection workflow remains usable.

This guard applies to every retained return event for the unit, not only the newest booking. Existing historical return evidence can therefore be completed through the supported inspection workflow before retirement instead of being stranded by archival.

## Boundaries

This authority does not force a damage case for `CLEAR` inspections, create a maintenance order, assess late-return fees, release or forfeit a security bond, change accepted money, or automatically return a unit to `AVAILABLE`. Non-clear inspection and terminal damage-resolution archival rules continue independently.

Relocation remains separate because moving a returned unit does not destroy its identity or make the retained return event uninspectable. Only physical-unit archival removes the active-unit prerequisite required by inspection authoring.

## Validation

`scripts/rental-pending-return-inspection-archive-source-contract.test.mjs` protects tenant scoping, permission checks, supported-route preflight ordering, the retained return-event correlation, and the database guard.

Live PostgreSQL concurrency testing still requires an explicitly disposable PostgreSQL target. Full repository validation still requires the project-supported Node 24 toolchain and installed dependencies.

GitHub Actions are not required or used.
