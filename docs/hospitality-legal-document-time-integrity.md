# Hospitality legal-document time integrity

Australian tax invoices and adjustment notes retain their issue time twice: in the relational `issuedAt` column and in the immutable JSON document snapshot used for rendering, fingerprint verification, accounting reads, and later legal-authority reconstruction. Application parsers already require those values and legal chronology to agree. PostgreSQL now enforces the same boundary for direct SQL/ORM writes.

## Database boundary

`20260924213000-hospitality-legal-document-time-integrity` adds two immutable validation helpers and validated check constraints.

For every retained tax invoice, `documentSnapshot.issuedAt` must be the canonical UTC millisecond timestamp emitted by the application and must resolve to exactly the same instant as the row `issuedAt` value.

For every retained adjustment-note schema currently supported by SF (versions 1 through 6), PostgreSQL additionally requires:

- snapshot `issuedAt` equals the row `issuedAt`;
- the immutable source tax-invoice issue time exists, is canonical, and does not follow the adjustment note;
- schemas 2 through 5 have a canonical commercial-amendment applied time between the source invoice and adjustment-note issue times;
- repeated commercial schemas 3 and 5 have a canonical predecessor issue time between the source invoice and current note, and the amendment cannot predate its predecessor; and
- terminal cancellation schema 6 has a canonical predecessor issue time between the source invoice and terminal note.

Both constraints are installed `NOT VALID` and immediately validated. Deployment therefore fails if retained legal evidence already violates the application contract; the migration does not rewrite or infer historical legal timestamps.

## Scope

This is defense in depth for immutable legal-document chronology. It does **not** change the current application writer clock, numbering sequence, tenant authorization, document fingerprint contract, or provider adapters. It also does not turn database time into the legal issue-time author; that is a separate service-level hardening decision because the fingerprinted snapshot and relational row must be created from the same value.

Most importantly, this migration does not claim to solve the remaining commercial settlement-evidence boundary. Commercial adjustment-note schemas 2 through 5 still re-prove historical settlement using retained payment rows whose provider lifecycle status can later change. A future versioned issue-time settlement-evidence contract must freeze only the legally relevant static settlement authority without blocking truthful provider reconciliation. Schema 6 can still inherit that predecessor-chain limitation.
