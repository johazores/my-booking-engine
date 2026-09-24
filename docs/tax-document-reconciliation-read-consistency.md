# Tax document reconciliation read consistency

Australian tax-document reconciliation deliberately separates immutable legal-document authority from current provider/payment lifecycle observations. The reconciliation process remains a bounded point-in-time application scan, but each multi-query read unit must observe internally consistent PostgreSQL state.

## Snapshot boundaries

`currentCounts` reads the tenant-scoped Australian tax-invoice and adjustment-note counts inside one `RepeatableRead` transaction. The reconciliation workflow still performs a separate count snapshot before and after the register scan so concurrent legal-document issuance remains detectable as `CONCURRENT_CHANGE` rather than being hidden by one long transaction.

Cancellation settlement-drift reconciliation reads the bounded tenant adjustment-note set and the current statuses of the exact frozen refund authorities inside one `RepeatableRead` transaction. Commercial-amendment settlement-drift reconciliation reads the tenant commercial adjustment-note rows, source invoices, amendments, target pricing evidence, and bounded payment history inside one `RepeatableRead` transaction. A drift result therefore cannot be assembled from mutually inconsistent database states inside either specialized scan.

Reconciliation history is a presentation collection. Its tenant-scoped audit count, clamped page calculation, and deterministic `createdAt desc, id desc` rows are read inside one `RepeatableRead` transaction so pagination metadata and returned history belong to the same snapshot.

## Deliberate boundaries

These snapshot changes do not turn mutable payment-provider status into immutable legal evidence. Schema-version-1 and schema-version-6 cancellation documents retain their existing frozen refund authority, while commercial-amendment schemas 2 through 5 still require a deliberate versioned issue-time settlement-evidence contract before historical legal reads can be fully separated from later provider-status changes.

The overall reconciliation operation also remains a bounded multi-stage application scan rather than one database transaction spanning every register page and audit write. Before/after legal-document counts continue to detect concurrent register changes. Live provider calls are not introduced by reconciliation.

## Validation

`scripts/tax-document-reconciliation-read-consistency-contract.test.mjs` protects tenant scope, bounded reads, `RepeatableRead` isolation for the count, cancellation-drift, commercial-drift, and history collection boundaries, deterministic history ordering, and the separation between snapshot consistency and future immutable settlement-evidence work.
