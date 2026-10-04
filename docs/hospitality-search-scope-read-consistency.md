# Hospitality search scope read consistency

## Implemented boundary

Internal and public hospitality offer discovery share `searchHospitalityOffersForOrganization`. Before availability and pricing evaluation begins, the search service resolves the bounded room-type/rate-plan scope set for the requested tenant and optional property.

The scope reader remains explicitly tenant-scoped and only includes active room types, properties, and rate plans. It orders scopes deterministically by property, room type, and rate plan and evaluates at most 50 scopes per search.

## Snapshot consistency

The authoritative scope count and the first bounded scope rows now execute inside one Prisma interactive transaction at PostgreSQL `RepeatableRead` isolation.

This matters because `totalScopes`, `searchedScopes`, and `scopeLimitReached` are returned to callers and drive the partial-result warning in both booking journeys. Under separate read-committed statements, a concurrent assignment create/archive could make the count and rows describe different database states. The shared snapshot makes that metadata coherent without escalating this read-only discovery step to a serializable commercial write.

Availability and pricing evaluation intentionally remains outside this transaction. Those services own their own current-state authority and booking confirmation still performs transactional revalidation before inventory is committed. Holding the scope snapshot open across network-independent but potentially expensive per-scope evaluation would provide no booking guarantee and would unnecessarily retain a database transaction.

## Validation

`scripts/hospitality-search-scope-read-consistency-contract.test.mjs` protects the tenant/property filters, active lifecycle filters, deterministic order, 50-scope bound, and shared `RepeatableRead` count/row snapshot. Full Prisma/PostgreSQL execution remains subject to the repository disposable-database validation gate.
