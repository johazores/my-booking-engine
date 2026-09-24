# Adjustment-note authority read consistency

Historical Australian adjustment-note verification is a multi-read legal-evidence operation. Every standalone verifier that reconstructs a commercial adjustment chain or terminal cancellation authority must observe its tenant-owned source invoice, adjustment rows, amendments, target pricing evidence, booking-linked payment evidence, and other required authority from one PostgreSQL snapshot.

## Snapshot boundary

`verifyHospitalityCommercialAmendmentAdjustmentRows` groups requested rows by tenant booking and source invoice, then verifies each group inside a `RepeatableRead` transaction. The underlying chain loader keeps organization, booking, and source-invoice predicates on every authoritative reload and retains the 5,000-document / 5,000-payment safety limits.

`verifyHospitalityCancellationAfterAmendmentAdjustmentRows` verifies each schema-version-6 terminal cancellation inside a `RepeatableRead` transaction. Its source invoice, verified predecessor chain, and exact frozen refund transaction identities are therefore checked from one database snapshot.

Schema-version-6 terminal refund authorities no longer re-run cancellation readiness against current mutable booking/payment status. The immutable document already freezes the ordered refund transaction IDs, ordinals, amounts, timestamps, legal before-price, and terminal legal effect. Historical verification now reloads only those exact tenant-owned refund rows and re-proves their structural identity, source attribution, money, and chronology while deliberately ignoring current `PaymentTransaction.status`. Current provider lifecycle drift remains a separate tax-document reconciliation concern.

Issuance/readiness paths that require stronger write coordination keep their existing `Serializable` transactions. The in-transaction authority helpers also keep using the caller transaction so a write workflow does not accidentally create a second snapshot.

## What this guarantees

The read boundary prevents a historical legal verifier from combining source material from different committed database states while concurrent amendment, payment, or legal-document work is occurring. It also prevents a later provider lifecycle status change on a schema-version-6 terminal refund from rewriting the historical terminal refund authority that was frozen at issuance. It does not weaken tenant scope, immutable document fingerprints, predecessor continuity, bounded-history failure behavior, or reconciliation drift reporting.

## What this does not guarantee

The commercial predecessor chain is still the unresolved boundary. Commercial adjustment-note schemas 2 through 5 reconstruct part of historical settlement authority from retained payment rows whose provider lifecycle status can change later. Because schema version 6 depends on that predecessor chain, this change separates the terminal refund leg from current status drift without pretending the whole chain is independent of legacy settlement evidence.

A future versioned commercial-adjustment contract must freeze the required issue-time settlement facts deliberately before that remaining boundary can be considered closed. This change therefore improves historical authority without claiming to solve the separate legacy legal-evidence versioning, migration, jurisdiction review, or live-provider validation work.
