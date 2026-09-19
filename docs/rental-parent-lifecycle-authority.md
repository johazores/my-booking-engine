# Rental parent lifecycle authority

Rental locations and rental unit types are parent inventory authority for active physical units. Unit types also own future rate-period configuration. A composite foreign key proves tenant ownership, but it does not prove that the retained parent is still `ACTIVE` while a concurrent child write is being committed.

SF therefore serializes parent archival with every fresh child write that depends on an active parent. This closes the race where a unit or rate period could be created against a parent that another transaction had just archived.

## Server authority

Supported inventory mutations continue to require authenticated tenant context and `inventory:manage`.

The application uses two explicit advisory-lock namespaces:

- `sf:rental-unit-type-lifecycle:<organization-id>:<unit-type-id>`;
- `sf:rental-location-lifecycle:<organization-id>:<location-id>`.

Fresh physical-unit creation resolves the tenant location, then locks unit type followed by location, re-reads both parents as `ACTIVE`, and only then inserts the unit. Fresh rate-period creation locks and revalidates its unit type before overlap review and insert. Unit relocation keeps the existing physical-unit lock first, then takes retained unit-type and target-location lifecycle locks in that order before revalidating the target location and changing the assignment. Mirroring the database trigger order avoids lock inversion with concurrent unit creation or parent archival.

Location and unit-type archival take their matching parent lifecycle lock before checking active physical-unit dependencies. Archival timestamps come from PostgreSQL `clock_timestamp()` after serialization rather than from the web-process clock.

These locks are authority, not scope. Every read and write still repeats `organizationId`; knowing a parent or child UUID never grants cross-tenant access.

## PostgreSQL defense in depth

`20260919212500_rental_parent_lifecycle_authority` installs matching database locks and guards.

For a fresh or newly-active physical unit, PostgreSQL takes the unit-type lifecycle lock and then the location lifecycle lock and requires both tenant-owned parents to be `ACTIVE`. Future writes therefore cannot create, relocate, retype, or reactivate an active unit onto an archived parent. Newly active unit evidence also requires a retained location; historical rows are not rewritten by the migration.

Fresh or re-parented rental rate periods take the unit-type lifecycle lock and require an active tenant-owned unit type. Existing retained rate periods may remain as history after their unit type is archived, and removal remains allowed.

Location and unit-type archive transitions take the same lifecycle locks and reject archival while any active tenant-owned physical unit still depends on the parent. This means both supported application writes and direct SQL serialize on the same parent boundary:

- if the child write wins the lock, parent archival observes the committed active unit and fails closed;
- if parent archival wins, the later child write re-reads the archived parent and fails closed.

The existing physical-unit lock remains separate and continues protecting holds, bookings, custody, maintenance, damage, and return-inspection evidence. Parent lifecycle locking does not weaken or replace those guards.

## Deliberate boundaries

Archiving a parent does not delete historical units, bookings, rate periods, or evidence. Archived physical units may continue to retain their historical parent relationships. This contract also does not add location reopening, unit-type reopening, customer pickup/drop-off semantics, one-way movement, transfer pricing, or delivery behavior.

## Validation

`src/server/inventory/rental-lock-domain.test.ts` protects the lock-key namespaces.

`scripts/rental-parent-lifecycle-source-contract.test.mjs` protects application lock/revalidation ordering, database child/parent guards, tenant scoping, deterministic unit-type-before-location ordering, and the retained-history boundary.

Full Prisma validation/generation, repository TypeScript 6 checks, lint, production build, and live PostgreSQL migration/concurrency execution still require the repository-supported Node 24 toolchain, installed dependencies, and an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
