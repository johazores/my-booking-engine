# Hospitality legal-document database clock

Australian hospitality tax invoices and adjustment notes use PostgreSQL wall-clock time as the authoritative issue-time source.

## Write boundary

Every current legal-document writer issues inside its existing `Serializable` transaction and calls `readHospitalityLegalDocumentIssueTime(transaction)`. The shared helper executes:

`SELECT date_trunc('milliseconds', clock_timestamp()) AS "issuedAt"`

The database samples wall-clock time for the active issuance attempt, then normalizes it to milliseconds before the value enters immutable evidence. Millisecond normalization is deliberate: legal snapshots use canonical UTC JSON timestamps with three fractional digits, while PostgreSQL `timestamptz` can retain finer precision.

The returned database-observed `Date` is used unchanged for:

- the immutable document snapshot `issuedAt`;
- the snapshot fingerprint input; and
- the relational issued-document `issuedAt` column.

No legal-document writer falls back to the application-node clock for issue time.

## Covered writers

The shared clock is used by:

- Australian tax-invoice issuance;
- cancellation adjustment-note issuance;
- cancellation-after-amendment terminal adjustment-note issuance;
- first commercial decreasing adjustment-note issuance;
- first commercial increasing adjustment-note issuance;
- repeated commercial decreasing adjustment-note issuance; and
- repeated commercial increasing adjustment-note issuance.

All seven preserve their existing tenant authorization, serializable numbering, source-document authority, pricing/settlement checks, idempotency or write-conflict handling, and immutable fingerprint validation.

## Retry semantics

If serializable issuance retries after a supported write conflict, the retried transaction reads a fresh database wall-clock value. Only the attempt that commits becomes immutable legal evidence. Fiscal numbering and the issued row still commit or roll back with the same transaction.

## Boundaries

This clock authority does not change payment-provider truth, settlement reconciliation, pricing evidence, recipient or issuer evidence, PDF rendering, accounting projections, retention policy, or jurisdiction-specific legal review. PostgreSQL chronology constraints remain an independent backstop for row/snapshot equality and source/predecessor ordering.
