# Rental tenant write scope

Rental inventory and availability-hold persistence is tenant-owned production data. Authorization and tenant-scoped reads are necessary, but they are not sufficient write protection by themselves. Every update and delete repeats the authenticated organization ID in the database mutation predicate.

## Write boundary

Rental inventory mutations require server-side `inventory:manage`. Rental hold release requires server-side `availability:manage`. Resource IDs are always resolved inside the authenticated organization before mutation, and the final Prisma update/delete predicate repeats `organizationId` even when the row ID is globally unique.

The current protected writes include:

- rental unit relocation
- rental location archival
- rental unit-type archival
- rental unit archival
- rental availability-block removal
- rental rate-period removal
- rental availability-hold lifecycle transitions

A tenant-scoped read does not replace write-time tenant scope. Keeping ownership in the final mutation predicate makes the invariant reviewable at the persistence boundary and prevents later refactors from accidentally turning a previously scoped read into ID-only write authority.

## Concurrency and lifecycle

Hold-sensitive physical-unit mutations continue to use the shared organization/unit advisory lock and database guards. Rental inventory lifecycle operations that already require serializable transactions retain that isolation level. Tenant write scope is additive to those concurrency controls; it does not replace locking, lifecycle validation, confirmation checks, or database foreign-key/composite ownership constraints.

Availability-hold release intentionally uses a tenant-scoped `updateMany` compare-and-set predicate so concurrent release/expiry transitions cannot overwrite a lifecycle state that already changed. The post-write read repeats the same organization scope.

## Validation

`scripts/rental-tenant-write-scope.test.mjs` is a dependency-free source contract included automatically by the repository `scripts/*.test.mjs` test glob. It protects the rental inventory update/delete predicates, the hold lifecycle compare-and-set boundary, and this documented invariant.

Full Prisma, TypeScript, lint, build, migration, drift, and PostgreSQL scenario validation still requires the repository-supported Node 24 toolchain and an explicitly disposable database target. No GitHub Actions are required or used for this validation.
