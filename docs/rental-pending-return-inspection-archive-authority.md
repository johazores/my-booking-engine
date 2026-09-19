# Rental pending-return inspection archive authority

A returned physical rental unit must remain active long enough for staff to record its durable return-condition inspection. Return inspection authoring deliberately requires the exact tenant-owned `RETURNED` custody event and an active retained physical unit. Allowing archival between those two steps would make the real return-inspection workflow impossible.

## Supported archive readiness

`archiveRentalUnit` remains the single supported physical-unit archive mutation. It requires `inventory:manage`, validates tenant/unit identity and explicit archive confirmation, acquires the shared tenant/unit advisory lock, and then evaluates both commercial/availability mutation authority and retained operational archive readiness inside the same serializable archive transaction before changing the unit to `ARCHIVED`.

The transaction-scoped readiness query evaluates one PostgreSQL snapshot for the exact tenant/unit and refuses archival when any of these retained operational obligations remain:

- a `RETURNED` fulfillment event still has no matching `RentalReturnInspection`;
- maintenance remains `OPEN` or `IN_PROGRESS`;
- a damage case remains `OPEN` or `ASSESSED`; or
- `DAMAGE_REPORTED` / `UNSAFE` inspection evidence has not reached a matching terminal `WAIVED` or `CLOSED` damage resolution.

Pending return inspection produces the existing inventory-conflict response. Active maintenance and unresolved damage evidence produce the inventory-dependency response. Because those decisions now execute after the shared physical-unit lock and before the archive update in the same transaction, a supported caller does not rely on a separate read-before-write preflight that can go stale while operational evidence changes.

The archive HTTP route is intentionally thin: it establishes authenticated tenant request context, parses the explicit confirmation, delegates once to `archiveRentalUnit`, and maps the service's domain errors to normal inventory feedback.

## PostgreSQL authority

`20260920003000-rental-pending-return-inspection-archive-guard` adds the pending-inspection database backstop. Physical-unit archival already acquires the shared tenant/unit advisory lock before lifecycle guards execute, and return-inspection insertion uses the same lock. After serialization, PostgreSQL rejects an `ACTIVE` → `ARCHIVED` transition when a tenant-owned `RETURNED` fulfillment event for that exact unit has no matching inspection bound to the same organization, return event, and unit.

The existing maintenance, damage-case, and non-clear-return-inspection archive guards independently enforce their own retained-evidence boundaries under that same physical-unit serialization contract. The transaction-scoped service query mirrors those guards for normal staff feedback; it does not replace them. PostgreSQL remains the final lifecycle boundary for direct writes and defense in depth.

If inspection or other protected operational evidence wins the shared lock first, archival waits and then evaluates the committed state before attempting the update. If archival wins the lock first, fresh protected operational writes serialize behind it and must satisfy their own active-unit authority once the archive transaction commits.

The pending-inspection guard applies to every retained return event for the unit, not only the newest booking. Existing historical return evidence can therefore be completed through the supported inspection workflow before retirement instead of being stranded by archival.

## Boundaries

This authority does not force a damage case for `CLEAR` inspections, create a maintenance order, assess late-return fees, release or forfeit a security bond, change accepted money, or automatically return a unit to `AVAILABLE`.

Relocation remains separate because moving a returned unit does not destroy its identity or make the retained return event uninspectable. Only physical-unit archival removes the active-unit prerequisite required by inspection and damage authoring.

## Validation

`scripts/rental-pending-return-inspection-archive-source-contract.test.mjs` protects tenant scoping, transaction ownership, shared-lock ordering, retained return-event correlation, the related maintenance/damage/non-clear readiness sweep, thin-route delegation, and the pending-inspection database guard.

Live PostgreSQL concurrency testing still requires an explicitly disposable PostgreSQL target. Full repository validation still requires the project-supported Node 24 toolchain and installed dependencies.

GitHub Actions are not required or used.
