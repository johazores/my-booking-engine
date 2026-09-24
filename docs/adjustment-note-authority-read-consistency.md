# Adjustment-note authority read consistency

Historical Australian adjustment-note verification is a multi-read legal-evidence operation. Every standalone verifier that reconstructs a commercial adjustment chain or terminal cancellation authority must observe its tenant-owned source invoice, adjustment rows, amendments, target pricing evidence, booking state, and bounded legal payment evidence from one PostgreSQL snapshot.

## Snapshot boundary

`verifyHospitalityCommercialAmendmentAdjustmentRows` groups requested rows by tenant booking and source invoice, then verifies each group inside a `RepeatableRead` transaction. The underlying chain loader keeps organization, booking, and source-invoice predicates on every authoritative reload and retains the 5,000-document / 5,000-payment safety limits.

`verifyHospitalityCancellationAfterAmendmentAdjustmentRows` verifies each schema-version-6 terminal cancellation inside a `RepeatableRead` transaction. Its source invoice, verified predecessor chain, booking, bounded issue-time payment evidence, derived readiness, and frozen refund-authority comparison therefore come from one database snapshot.

Issuance/readiness paths that already require stronger write coordination keep their existing `Serializable` transactions. The in-transaction authority helpers also keep using the caller transaction so a write workflow does not accidentally create a second snapshot.

## What this guarantees

The read boundary prevents a historical legal verifier from combining source material from different committed database states while concurrent amendment, payment, or legal-document work is occurring. It does not weaken tenant scope, immutable document fingerprints, predecessor continuity, issue-time horizons, bounded-history failure behavior, or reconciliation drift reporting.

## What this does not guarantee

Snapshot consistency is not a replacement for immutable issue-time settlement evidence. Commercial adjustment-note schemas 2 through 5 still reconstruct part of historical settlement authority from retained payment rows whose provider lifecycle status can change later. A future versioned legal-document contract must freeze the required issue-time settlement facts deliberately before that remaining boundary can be considered closed.

This change therefore improves read consistency without claiming to solve the separate legal-evidence versioning, migration, jurisdiction review, or live-provider validation work.
