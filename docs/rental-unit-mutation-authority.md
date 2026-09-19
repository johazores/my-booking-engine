# Rental physical-unit mutation authority

Relocating, retyping, or archiving a physical rental unit changes live inventory identity. SF therefore treats those mutations as inventory-authority decisions rather than ordinary catalog edits.

## Server authority

Supported relocation and unit archival require `inventory:manage`, repeat tenant scope from authenticated server context, and run inside a serializable transaction under the tenant/physical-unit advisory lock.

After acquiring that lock, the service samples PostgreSQL `clock_timestamp()` once and refuses relocation or archival while any of these common conditions remain true:

- a tenant-owned `ACTIVE` availability hold still has `expiresAt` after the database observation;
- a non-cancelled allocation is still current or future using that booking's retained location timezone and exclusive `endsOn` boundary; or
- the unit has overdue open custody derived from append-only pickup/return evidence and the latest supported custody extension.

Before the supported archive route reaches that mutation boundary, a separate `inventory:manage`-authorized tenant/unit readiness query mirrors the operational evidence that PostgreSQL protects independently. It rejects retirement while return inspection is still pending, maintenance remains `OPEN` / `IN_PROGRESS`, a damage case remains `OPEN` / `ASSESSED`, or non-clear return inspection evidence has not reached terminal damage resolution. These domain-level conflict/dependency failures prevent normal staff operations from surfacing an opaque server error for a known lifecycle blocker.

The readiness query is deliberately not treated as concurrency authority. Fresh maintenance, inspection, or damage evidence can race after a preflight read, so the shared physical-unit lock and PostgreSQL archive guards remain the final write boundary.

The common service helper is shared by relocation and archival for hold, booking, and custody authority so one path cannot silently become less strict than the other. A past booking with no open custody does not permanently pin a physical unit to historical inventory metadata.

## Custody boundary

A picked-up unit cannot become mutable merely because its committed allocation date has passed. If return evidence is still missing at the exclusive effective end, the existing extension-aware overdue-custody authority continues protecting the physical unit until staff record a real return or apply a supported custody extension.

This rule does not create a return, extend a rental, assess a fee, cancel a booking, or change accepted money. It only prevents physical inventory identity from contradicting retained custody evidence.

## PostgreSQL defense in depth

`20260919192500_rental_unit_mutation_custody_authority` replaces the active `sf_guard_rental_unit_mutation_against_holds` function without changing its trigger binding.

That guard keeps the active-hold check, evaluates current/future booking authority in each booking's retained IANA location timezone, and calls the existing `sf_rental_unit_has_overdue_custody` predicate for the post-end open-custody case.

`20260919202500_rental_unit_mutation_serialization` closes the remaining direct-write race between unit identity/lifecycle changes and fresh operational evidence. It installs an alphabetically early `BEFORE UPDATE` trigger on rental-unit location, type, and lifecycle status so the shared tenant/unit advisory lock is held before the existing hold/booking/custody, active-maintenance, and unresolved-damage guards evaluate the mutation.

The same migration installs alphabetically early `BEFORE INSERT` locks on maintenance work orders and damage cases. A direct SQL insert that waits behind a concurrent archive therefore reaches its existing active-tenant-unit authoring guard only after the archive releases the lock. Conversely, an archive waits behind fresh maintenance or unresolved damage evidence and then observes that committed evidence before its existing archive guards run.

`20260919203500_rental_return_inspection_archive_authority` extends that serialization to fresh return inspections and closes the pre-damage-case archival gap. `DAMAGE_REPORTED` or `UNSAFE` inspection evidence now prevents archival until its retained damage case reaches `WAIVED` or `CLOSED`. Staff therefore cannot archive the unit before opening that damage workflow and accidentally make the existing active-unit damage-case authoring contract impossible to satisfy.

`20260920003000-rental-pending-return-inspection-archive-guard` additionally prevents retirement after retained `RETURNED` custody evidence but before its matching return inspection is recorded. The supported archive readiness check mirrors all three operational-evidence families before invoking the write, while these PostgreSQL guards remain authoritative under concurrency and for direct SQL.

All physical-unit lock keys repeat `organizationId` and physical `unitId`. Application maintenance and damage writers already use the same physical-unit lock namespace, so supported service writes and database-bypass writes serialize on one physical-inventory authority boundary.

Parent location and unit-type lifecycle use separate tenant-scoped lock namespaces so fresh unit/rate authority cannot race parent archival. See [rental-parent-lifecycle-authority.md](./rental-parent-lifecycle-authority.md).

## Deliberate boundaries

This authority does not add customer-facing pickup/drop-off selection, one-way movement, transfer pricing, delivery, or automatic fleet repositioning. It also does not make historical allocations or operational evidence mutable. Supported same-type/same-location booking substitution remains a separate booking lifecycle operation.

Relocation is not automatically forbidden merely because maintenance or damage evidence exists; those workflows may legitimately require physical movement. The additional operational-evidence rule is specifically an archival boundary, matching the existing maintenance, return-inspection, and damage archive guards.

## Validation

`scripts/rental-unit-mutation-custody-source-contract.test.mjs` protects the shared application guard, post-lock database clock, tenant-scoped current/future booking test, overdue-custody check, and PostgreSQL backstop.

`scripts/rental-unit-mutation-serialization-source-contract.test.mjs` protects the early unit-mutation lock, maintenance/damage insert locks, shared lock namespace, existing active-unit authoring guards, active maintenance/unresolved damage archival boundaries, and the supported operational-readiness mirror.

`scripts/rental-return-inspection-archive-source-contract.test.mjs` protects return-inspection serialization plus the non-clear-inspection-to-terminal-damage-resolution archival boundary.

`scripts/rental-pending-return-inspection-archive-source-contract.test.mjs` protects the supported archive readiness sweep plus the pending-return-inspection database boundary.

`scripts/rental-parent-lifecycle-source-contract.test.mjs` protects the separate location/unit-type lifecycle locks and their child-write/archive serialization contract.

Full Prisma, TypeScript, lint, production build, and live migration execution still require the repository-supported Node 24 toolchain and an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
