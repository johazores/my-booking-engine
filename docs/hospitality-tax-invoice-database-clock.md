# Hospitality tax-invoice database clock

Australian hospitality tax invoices use PostgreSQL wall-clock time as the authoritative issue-time source.

## Write boundary

`issueHospitalityAustralianTaxInvoice` runs inside its existing serializable transaction and calls `readHospitalityLegalDocumentIssueTime(transaction)`. The shared helper executes `SELECT clock_timestamp()` through that same Prisma transaction.

The returned database-observed `Date` is used unchanged for:

- the immutable tax-invoice snapshot `issuedAt`;
- the snapshot fingerprint input; and
- the relational `HospitalityIssuedInvoice.issuedAt` column.

The tax-invoice writer does not use the application-node clock as a legal issue-time fallback. Existing PostgreSQL constraints independently require the canonical snapshot timestamp and relational timestamp to resolve to the same instant.

## Retry semantics

If serializable issuance retries after a supported write conflict, the retried transaction reads a fresh PostgreSQL wall-clock value. Only the attempt that commits becomes immutable legal evidence. Fiscal numbering remains transactional and commits or rolls back with the invoice row.

## Current boundary

This revision intentionally moves the tax-invoice writer first. Existing adjustment-note schemas continue to retain their current writer-clock behavior and remain protected by row/snapshot chronology constraints. They are not claimed as database-clock-authored yet.

The change does not alter tenant authorization, pricing evidence, recipient/issuer evidence, payment or settlement authority, provider behavior, numbering rules, rendering, accounting projections, reconciliation, or jurisdiction/legal review boundaries.
