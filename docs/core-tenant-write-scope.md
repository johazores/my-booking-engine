# Core tenant write scope

SF treats tenant authorization and tenant ownership as separate server-side checks. Permission checks decide whether an actor may perform an operation; the final persistence mutation must still retain the tenant/resource scope that was authorized and validated earlier in the transaction.

## Covered boundaries

This contract covers the core tenant-administration and customer mutations that are not provider-specific commercial writes:

- Customer profile update and archival repeat `organizationId` and the expected customer lifecycle state in the final Prisma update predicate.
- Archived customer de-identification repeats `organizationId` and requires the row to still be `ARCHIVED` when personal fields are cleared.
- Organization membership role/status mutations repeat `organizationId` and the previously validated membership role/status in the final update predicate. The existing serializable last-active-admin protection remains authoritative.
- Tenant branding updates pin the final organization mutation to the authorized organization ID while requiring the organization to still be active and non-deleted.
- Organization settings and archival writes likewise pin the final mutation to the authorized organization ID plus the expected active/non-deleted lifecycle state.

For tenant-owned child records, organization ownership is represented by an explicit `organizationId`. The organization row itself is the tenant root, so it cannot repeat a separate tenant foreign key; root mutations instead bind the exact server-authorized organization ID and its expected lifecycle state.

## Why repeat scope at mutation time

The reviewed services already validate identifiers, authenticate the actor, authorize the required capability, and perform tenant-scoped reads before writing. Repeating ownership/lifecycle constraints in the final update is defense in depth rather than evidence of a demonstrated cross-tenant exploit.

Keeping the scope on the write boundary prevents a later refactor from accidentally turning a safe tenant-scoped lookup followed by an ID-only mutation into two independently unsafe steps. Expected lifecycle/role/status values also reduce the chance that a stale application assumption can silently mutate a row after its relevant state changed.

## Boundaries intentionally kept separate

Payment, refund, reconciliation, invoice, adjustment-note, supplier, and other provider/commercial writes are not bulk-modified by this contract. Those paths have their own idempotency, provider-truth, settlement, reconciliation, immutable-document, locking, and state-machine semantics and require a dedicated focused review rather than mechanical predicate changes.

Test-only setup and cleanup mutations are also excluded because they are not production authorization boundaries.

## Verification

`scripts/core-tenant-write-scope.test.mjs` is a dependency-free source contract covering the customer, membership, branding, and organization-management persistence boundaries plus this documented scope. It is included automatically by the repository `scripts/*.test.mjs` test glob.

Full Prisma validation/generation, TypeScript checking, lint, build, migration/drift validation, and PostgreSQL integration execution still require the repository-supported Node 24 environment, installed dependencies, and an explicitly disposable PostgreSQL target. GitHub Actions are intentionally not used.
