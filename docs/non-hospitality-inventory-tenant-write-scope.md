# Non-hospitality inventory tenant write scope

The advanced non-hospitality inventory foundations for rental, tour, and appointment inventory are tenant-owned production data. Server authorization and tenant-scoped reads remain mandatory, and mutable lifecycle operations now also repeat the authenticated organization ID in the final update or delete predicate.

## Covered services

- Rental inventory uses `inventory:manage` for inventory mutations and `availability:manage` for hold lifecycle transitions. Rental relocation, archive, availability-block removal, rate-period removal, and hold release all retain tenant ownership at write time.
- Tour inventory uses `inventory:manage`. Departure, add-on, and product archive writes repeat `organizationId` after the tenant-scoped active-record lookup.
- Appointment inventory uses `inventory:manage`. Schedule, service, and staff archive writes repeat `organizationId`; staff/service assignment removal already uses the organization-owned composite key.

The invariant is deliberately redundant with globally unique row IDs. A scoped read proves the caller may act on the resource at that point in the transaction; the write predicate independently preserves tenant ownership if surrounding code is refactored later.

## Scope boundary

This sweep remains intentionally limited to the related rental, tour, and appointment inventory foundation cluster. The follow-up hospitality review now applies the same write-time ownership rule to hospitality inventory, pricing archives, availability windows, availability-hold release, and booking-confirmation hold consumption; see `docs/hospitality-tenant-write-scope.md`.

The remaining ID-only production mutations found by the broader pattern sweep are primarily in customer, payment/reconciliation, branding, and organization-management code. Those paths have different lifecycle, external-provider, optimistic-state, or organization-root semantics and require their own focused review rather than speculative bulk changes.

That remaining review is not evidence of a demonstrated cross-tenant exploit: the affected patterns generally follow tenant-scoped reads and globally unique IDs. It is defense-in-depth parity work needed to make write-time tenant ownership consistent across the wider platform.

## Validation

`scripts/rental-tenant-write-scope.test.mjs` protects the rental persistence boundary. `scripts/non-hospitality-inventory-tenant-write-scope.test.mjs` protects tour and appointment archive writes and the already composite-scoped appointment assignment deletion.

Both files are dependency-free source contracts included by the repository `scripts/*.test.mjs` test glob. Full Prisma, TypeScript, lint, build, database migration/drift, and PostgreSQL integration validation still requires the supported Node 24 environment and an explicitly disposable database target. No GitHub Actions are required or used.
