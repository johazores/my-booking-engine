# Rental custody-extension return reconciliation

A rental pickup is immutable historical handoff evidence. A supported in-custody extension does not rewrite that pickup row: it appends a price-neutral reschedule whose start and physical unit remain fixed while the committed end moves later. Return then snapshots the current effective committed end.

That means a valid extended rental intentionally has different `endsOn` values across custody events: pickup keeps the earlier commitment and return keeps the later extension. Downstream return workflows must treat this as expected evidence rather than corruption, while still rejecting a changed start, changed unit, shortened end, or return timestamp before pickup.

The late-return assessment boundary follows the immutable return snapshot because the fulfillment database guard already required that snapshot to match the current tenant-owned allocation when handback was recorded. Its PostgreSQL authoring guard independently requires the pickup and return to keep the same start and physical unit and permits the return end only when it is equal to or later than the pickup end.

Idempotent pickup replay follows the same historical rule. A later custody extension may make the current effective end later than the retained pickup end, so replay requires the same effective unit and start, refuses a pickup end later than the current commitment, and validates the pickup window against the pickup row's own retained dates. Return replay still requires an exact match with the current effective end because no further extension can be appended after return.

This reconciliation does not permit arbitrary in-custody rescheduling, shortening, unit changes, price changes, post-return extensions, or browser-authored custody dates.
