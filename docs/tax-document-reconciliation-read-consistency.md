# Tax document reconciliation read consistency

Australian tax-document reconciliation deliberately separates immutable legal-document authority from current provider/payment lifecycle observations. Each reconciliation run is a bounded point-in-time database review and records one internally consistent PostgreSQL snapshot.

## Reconciliation snapshot boundary

After server-side `booking:read` and `payment:read` authorization, `reconcileHospitalityAustralianTaxDocuments` opens one caller-owned `RepeatableRead` transaction. The tenant-scoped Australian tax-invoice and adjustment-note counts, bounded register pages, immutable invoice validation, complete adjustment-note authority validation, cancellation refund-status drift, commercial-amendment settlement drift, report construction, and reconciliation audit insert all use that same transaction.

Before the bounded register reads begin, the transaction samples PostgreSQL `date_trunc('milliseconds', clock_timestamp())`. That one database-observed value is the reconciliation report `checkedAt` and the retained reconciliation `AuditEvent.createdAt`. The application-node wall clock does not author reconciliation chronology, so history `recordedAt` and the report check time refer to the same database observation.

Register validation therefore cannot combine legal rows selected before a concurrent write with source/refund/commercial authority selected after it. Cancellation and commercial settlement drift also observe the exact payment state visible to the same reconciliation snapshot.

A legal document committed after the reconciliation snapshot starts is intentionally outside that run and is picked up by the next run. It is not reported as corruption merely because it committed concurrently. The historical `CONCURRENT_CHANGE` failure code remains parseable for previously stored reconciliation audit records.

The standalone commercial settlement reconciliation entry point still owns a `RepeatableRead` compatibility wrapper for callers that do not already own a transaction. The tax-document reconciliation workflow uses its transaction-aware entry point so it does not open a nested independent snapshot.

Reconciliation history is a presentation collection. Its tenant-scoped audit count, clamped page calculation, and deterministic `createdAt desc, id desc` rows are read inside one separate `RepeatableRead` transaction so pagination metadata and returned history belong to the same snapshot. New summaries use audit schema version 3. For schema version 3 only, history fails closed unless the retained `AuditEvent.createdAt` exactly matches the parsed report `checkedAt`, proving that both values came from the same database-clock observation. Historical schema versions 1 and 2 remain readable under their original contracts: schema 2 preserves occurrence counts but predates this event-metadata clock binding, while schema 1 also predates durable failure counts.

## Deliberate boundaries

Snapshot consistency and immutable issue-time authority remain different concerns. Schema-version-1 and schema-version-6 cancellation documents keep their frozen refund identity/authority contracts. Newly issued commercial-amendment schemas 2 through 5 replay frozen issue-time settlement evidence, while pre-migration commercial documents intentionally retain the bounded legacy payment-history fallback because SF cannot truthfully reconstruct status that was never frozen at issuance.

Current provider lifecycle remains mutable operational truth. Reconciliation compares the current payment state visible to its database snapshot with issued legal authority and may report settlement drift without rewriting, hiding, or invalidating an immutable document.

The transaction remains bounded by the existing 5,000-document synchronous reconciliation limit, 100-row register pages, and the bounded commercial payment-history limit. Reconciliation performs no live provider calls.

## Validation

`scripts/tax-document-reconciliation-read-consistency-contract.test.mjs` protects tenant scope, bounded register reads, the single caller-owned `RepeatableRead` reconciliation transaction, transaction-aware invoice/adjustment authority validation, cancellation and commercial settlement drift, same-transaction audit persistence, deterministic history ordering, and the separation between immutable issue-time evidence, legacy pre-migration evidence, and current provider lifecycle truth.
