# Rental physical-unit mutation authority

Relocating, retyping, or archiving a physical rental unit changes live inventory identity. SF therefore treats those mutations as inventory-authority decisions rather than ordinary catalog edits.

## Server authority

Supported relocation and unit archival require `inventory:manage`, repeat tenant scope from authenticated server context, and run inside a serializable transaction under the tenant/physical-unit advisory lock.

After acquiring that lock, the service samples PostgreSQL `clock_timestamp()` once and refuses relocation or archival while any of these common conditions remain true:

- a tenant-owned `ACTIVE` availability hold still has `expiresAt` after the database observation;
- a non-cancelled allocation is still current or future using that booking's retained location timezone and exclusive `endsOn` boundary; or
- the unit has overdue open custody derived from append-only pickup/return evidence and the latest supported custody extension.

Archival has additional operational evidence guards at the database boundary: an active `OPEN`/`IN_PROGRESS` maintenance work order or unresolved `OPEN`/`ASSESSED` damage case must be completed, cancelled, waived, or closed through its real lifecycle before the physical unit can be archived. Those retained records are not deleted or silently rewritten by archival.

The common service helper is shared by relocation and archival so one path cannot silently become less strict than the other. A past booking with no open custody does not permanently pin a physical unit to historical inventory metadata.

## Custody boundary

A picked-up unit cannot become mutable merely because its committed allocation date has passed. If return evidence is still missing at the exclusive effective end, the existing extension-aware overdue-custody authority continues protecting the physical unit until staff record a real return or apply a supported custody extension.

This rule does not create a return, extend a rental, assess a fee, cancel a booking, or change accepted money. It only prevents physical inventory identity from contradicting retained custody evidence.

## PostgreSQL defense in depth

`20260919192500_rental_unit_mutation_custody_authority` replaces the active `sf_guard_rental_unit_mutation_against_holds` function without changing its trigger binding.

That guard keeps the active-hold check, evaluates current/future booking authority in each booking's retained IANA location timezone, and calls the existing `sf_rental_unit_has_overdue_custody` predicate for the post-end open-custody case.

`20260919202500_rental_unit_mutation_serialization` closes the remaining direct-write race between unit identity/lifecycle changes and fresh operational evidence. It installs an alphabetically early `BEFORE UPDATE` trigger on rental-unit location, type, and lifecycle status so the shared tenant/unit advisory lock is held before the existing hold/booking/custody, active-maintenance, and unresolved-damage guards evaluate the mutation.

The same migration installs alphabetically early `BEFORE INSERT` locks on maintenance work orders and damage cases. A direct SQL insert that waits behind a concurrent archive therefore reaches its existing active-tenant-unit authoring guard only after the archive releases the lock. Conversely, an archive waits behind fresh maintenance or unresolved damage evidence and then observes that committed evidence before its existing archive guards run.

All lock keys repeat `organizationId` and physical `unitId`. Application maintenance and damage writers already use the same lock namespace, so supported service writes and database-bypass writes now serialize on one physical-inventory authority boundary.

## Deliberate boundaries

This authority does not add customer-facing pickup/drop-off selection, one-way movement, transfer pricing, delivery, or automatic fleet repositioning. It also does not make historical allocations or operational evidence mutable. Supported same-type/same-location booking substitution remains a separate booking lifecycle operation.

Relocation is not automatically forbidden merely because maintenance or damage evidence exists; those workflows may legitimately require physical movement. The additional operational-evidence rule is specifically an archival boundary, matching the existing maintenance and damage archive guards.

## Validation

`scripts/rental-unit-mutation-custody-source-contract.test.mjs` protects the shared application guard, post-lock database clock, tenant-scoped current/future booking test, overdue-custody check, and PostgreSQL backstop.

`scripts/rental-unit-mutation-serialization-source-contract.test.mjs` protects the early unit-mutation lock, maintenance/damage insert locks, shared lock namespace, existing active-unit authoring guards, and active maintenance/unresolved damage archival boundaries.

Full Prisma, TypeScript, lint, production build, and live migration execution still require the repository-supported Node 24 toolchain and an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
