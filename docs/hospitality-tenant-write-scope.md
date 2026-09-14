# Hospitality tenant write scope

Hospitality inventory, pricing, availability, and booking-allocation state is tenant-owned production data. Server authorization and tenant-scoped reads remain mandatory, and mutable writes also repeat tenant/resource ownership in the final Prisma update or delete predicate instead of relying only on a preceding scoped read plus a globally unique row ID.

## Covered boundaries

- Hospitality inventory property, room-type, room, and amenity archival repeats `organizationId` at mutation time.
- Property and room-type image primary selection and removal repeat the organization/property scope, and room-type image writes also repeat `roomTypeId`.
- Hospitality base-rate, charge-rule, and add-on archival repeats both `organizationId` and `propertyId`.
- Availability-window archival repeats organization/property/room-type scope while retaining the existing allocation advisory lock.
- Availability-hold release and booking-confirmation hold consumption repeat organization/property/room-type scope while retaining the same allocation lock and lifecycle rules.
- Rate-plan archival, restriction archival, rate-plan assignment removal, and amenity assignment removal already use tenant-owned composite unique selectors and remain unchanged.

This is defense in depth. The reviewed paths already performed server authorization and tenant-scoped reads before mutation, so this hardening is not a claim that a demonstrated cross-tenant exploit existed. Repeating scope at the final persistence boundary reduces the chance that a later refactor can accidentally separate an authorized tenant lookup from an ID-only write.

## Scope boundary

The similar-pattern sweep still finds ID-only mutations in customer, payment/reconciliation, branding, and organization-management code. Those areas have materially different lifecycle, optimistic-state, external-provider, or organization-root semantics and should be reviewed as separate focused production changes rather than bulk-edited under the hospitality inventory/pricing scope.

Test-only setup/cleanup mutations are not production authorization boundaries and are intentionally excluded from this rule.

## Validation

`scripts/hospitality-tenant-write-scope.test.mjs` protects the reviewed inventory, pricing, availability, and hold-consumption boundaries and also records the already-safe composite-key exceptions.

The source contract is dependency-free and is included by the repository `scripts/*.test.mjs` test glob. Full Prisma, TypeScript, lint, build, migration/drift, and PostgreSQL integration validation still requires the repository-supported Node 24 environment, installed dependencies, and an explicitly disposable PostgreSQL target. No GitHub Actions are required or used.
