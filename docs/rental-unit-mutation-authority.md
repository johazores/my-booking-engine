# Rental physical-unit mutation authority

Relocating, retyping, or archiving a physical rental unit changes live inventory identity. SF therefore treats those mutations as inventory-authority decisions rather than ordinary catalog edits.

## Server authority

Supported relocation and unit archival require `inventory:manage`, repeat tenant scope from authenticated server context, and run inside a serializable transaction under the tenant/physical-unit advisory lock.

After acquiring that lock, the service samples PostgreSQL `clock_timestamp()` once and refuses the mutation while any of these conditions remain true:

- a tenant-owned `ACTIVE` availability hold still has `expiresAt` after the database observation;
- a non-cancelled allocation is still current or future using that booking's retained location timezone and exclusive `endsOn` boundary; or
- the unit has overdue open custody derived from append-only pickup/return evidence and the latest supported custody extension.

The same shared helper is used by relocation and archival so one path cannot silently become less strict than the other. A past booking with no open custody does not permanently pin a physical unit to historical inventory metadata.

## Custody boundary

A picked-up unit cannot become mutable merely because its committed allocation date has passed. If return evidence is still missing at the exclusive effective end, the existing extension-aware overdue-custody authority continues protecting the physical unit until staff record a real return or apply a supported custody extension.

This rule does not create a return, extend a rental, assess a fee, cancel a booking, or change accepted money. It only prevents physical inventory identity from contradicting retained custody evidence.

## PostgreSQL defense in depth

`20260919192500-rental-unit-mutation-custody-authority` replaces the active `sf_guard_rental_unit_mutation_against_holds` function without changing its trigger binding.

The trigger acquires the same tenant/unit advisory lock and only then samples `clock_timestamp()`. It keeps the active-hold check, replaces session/transaction `CURRENT_DATE` booking authority with each booking's retained IANA location timezone, and calls the existing `sf_rental_unit_has_overdue_custody` predicate for the post-end open-custody case.

All booking, allocation, location, hold, and custody predicates repeat `organizationId`. Direct SQL therefore cannot bypass the tenant or custody boundary simply by updating `rental_units.locationId`, `unitTypeId`, or lifecycle `status`.

## Deliberate boundaries

This authority does not add customer-facing pickup/drop-off selection, one-way movement, transfer pricing, delivery, or automatic fleet repositioning. It also does not make historical allocations mutable. Supported same-type/same-location booking substitution remains a separate booking lifecycle operation.

## Validation

`scripts/rental-unit-mutation-custody-source-contract.test.mjs` protects the shared application guard, post-lock database clock, tenant-scoped current/future booking test, overdue-custody check, and PostgreSQL backstop.

Full Prisma, TypeScript, lint, production build, and live migration execution still require the repository-supported Node 24 toolchain and an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
