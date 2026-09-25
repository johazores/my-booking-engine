# Hospitality legal-document time integrity

Australian tax invoices and adjustment notes retain their issue time twice: in the relational `issuedAt` column and in the immutable JSON document snapshot used for rendering, fingerprint verification, accounting reads, and later legal-authority reconstruction. Application parsers require those values and legal chronology to agree. PostgreSQL independently enforces the same retained-evidence boundary.

## Database boundary

`20260924213000-hospitality-legal-document-time-integrity` adds immutable validation helpers and validated check constraints.

For every retained tax invoice, `documentSnapshot.issuedAt` must be the canonical UTC millisecond timestamp emitted by the writer and must resolve to exactly the same instant as the row `issuedAt` value.

For every retained adjustment-note schema currently supported by SF (versions 1 through 6), PostgreSQL additionally requires:

- snapshot `issuedAt` equals the row `issuedAt`;
- the immutable source tax-invoice issue time exists, is canonical, and does not follow the adjustment note;
- schemas 2 through 5 have a canonical commercial-amendment applied time between the source invoice and adjustment-note issue times;
- repeated commercial schemas 3 and 5 have a canonical predecessor issue time between the source invoice and current note, and the amendment cannot predate its predecessor; and
- terminal cancellation schema 6 has a canonical predecessor issue time between the source invoice and terminal note.

Both constraints are installed `NOT VALID` and immediately validated. Deployment therefore fails if retained legal evidence already violates the application contract; the migration does not rewrite or infer historical legal timestamps.

## Writer clock authority

All seven current Australian hospitality legal-document writers use the shared `hospitality-legal-document-clock.ts` helper inside their existing `Serializable` issuance transactions. The helper reads PostgreSQL `date_trunc('milliseconds', clock_timestamp())`, so the database is the single wall-clock authority while the observed value is normalized to the canonical millisecond precision required by the immutable JSON timestamp contract.

The same database-observed `Date` is reused for the immutable snapshot, fingerprint input, and relational `issuedAt` value. There is no application-node issue-time fallback. If a serializable issuance attempt retries after a supported write conflict, only the database time observed by the committed attempt becomes legal evidence.

This applies to the tax-invoice writer, cancellation adjustment notes, commercial decreasing and increasing adjustment notes, repeated commercial decreasing and increasing adjustment notes, and terminal cancellation-after-amendment adjustment notes.

## Scope

This is defense in depth for immutable legal-document chronology. It does not change fiscal numbering, tenant authorization, document fingerprint semantics, pricing authority, settlement authority, or provider adapters.

Commercial settlement evidence remains a separate immutable boundary. New schema-version-2-through-5 commercial adjustment notes freeze the provider-neutral issue-time payment ledger in the issuance transaction, while pre-migration commercial notes remain on the bounded retained-payment fallback because their historical provider status cannot be reconstructed truthfully. Time-integrity constraints prove chronology but do not replace settlement capture or current provider reconciliation.
