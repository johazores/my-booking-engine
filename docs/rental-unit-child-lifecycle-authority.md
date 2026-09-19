# Rental physical-unit child lifecycle authority

Fresh rental availability and operational authority must belong to an active tenant-owned physical unit. A composite foreign key proves that a child row points at the same organization, but it does not prove that the retained physical unit is still active when a concurrent write commits.

Application services already use the shared `sf:rental-unit:<organization-id>:<unit-id>` advisory lock before creating an availability hold, creating an unavailable-date block, or changing operational state. They then re-read the tenant unit as `ACTIVE`; hold creation additionally requires its retained unit type and operating location to be active. Physical-unit archival uses the same lock.

## PostgreSQL authority

`20260919233500-rental-unit-child-lifecycle-authority` makes the database boundary match that application contract. The migration adds one shared assertion that:

- takes the tenant/physical-unit advisory lock before reading lifecycle state;
- resolves the exact tenant unit through its retained unit type and operating location;
- requires the unit, unit type, and location to all remain `ACTIVE`; and
- fails closed when the unit is missing, cross-tenant, detached from an active parent, or already archived.

The assertion is applied to three live child-authority surfaces:

- unavailable-date block inserts and availability-changing block updates;
- `ACTIVE` availability-hold inserts/reactivations and authority-changing hold updates; and
- rental-unit operational-state inserts and updates.

Trigger names are alphabetically early so the shared lifecycle lock and active-unit revalidation happen before the older overlap or operational-availability triggers evaluate the same write.

## Concurrency behavior

Archival and fresh child authority now serialize on the same unit lock.

If the child write wins first, it validates against active inventory and commits before archival continues. Existing archival rules then decide whether that child authority blocks archival; an effective active hold does, while a retained unavailable-date block or operational-state row may remain as history after a later valid archive.

If archival wins first, the later child write waits, re-reads the now-archived unit, and fails. This prevents a direct SQL writer from creating a new live hold, adding new availability configuration, or mutating current operational state after inventory retirement.

Inactive hold transitions remain deliberately allowed after archival because release/expiry/consumption reduces live authority and can be necessary to finish historical state cleanup. Existing blocks and operational-state rows are retained rather than deleted by archival; the new guard only closes fresh or authority-changing writes.

## Scope boundaries

This change does not reopen archived units, invent automatic cleanup, remove retained availability evidence, or change booking/payment/custody semantics. Maintenance work orders already require an active tenant unit at the database boundary, and booking confirmation already independently validates active unit, unit-type, and location authority.

Tenant scope remains explicit on every database lookup. The advisory lock is a concurrency boundary, not an authorization mechanism.

## Validation

`scripts/rental-unit-child-lifecycle-authority-source-contract.test.mjs` protects the shared unit lock, active parent revalidation, trigger ordering, active-hold-only lifecycle rule, and retained-history boundaries.

Live PostgreSQL migration/concurrency testing still requires an explicitly disposable PostgreSQL target. Full repository validation still requires the project-supported Node 24 toolchain and installed dependencies.

GitHub Actions are not required or used.
