# Adjustment-note authority read consistency

Historical Australian adjustment-note verification is a multi-read legal-evidence operation. Every standalone verifier that reconstructs a commercial adjustment chain or terminal cancellation authority must observe its tenant-owned source invoice, adjustment rows, amendments, target pricing evidence, booking-linked payment evidence, and other required authority from one PostgreSQL snapshot.

## Snapshot boundary

`verifyHospitalityCommercialAmendmentAdjustmentRows` groups requested rows by tenant booking and source invoice, then verifies each group inside a `RepeatableRead` transaction. The underlying chain loader keeps organization, booking, and source-invoice predicates on every authoritative reload and retains the 5,000-document / 5,000-payment safety limits.

`verifyHospitalityCancellationAfterAmendmentAdjustmentRows` verifies each schema-version-6 terminal cancellation inside a `RepeatableRead` transaction. Its source invoice, verified predecessor chain, and exact frozen refund transaction identities are therefore checked from one database snapshot.

Schema-version-6 terminal refund authorities no longer re-run cancellation readiness against current mutable booking/payment status. The immutable document already freezes the ordered refund transaction IDs, ordinals, amounts, timestamps, legal before-price, and terminal legal effect. Historical verification now reloads only those exact tenant-owned refund rows and re-proves their structural identity, source attribution, money, and chronology while deliberately ignoring current `PaymentTransaction.status`. Current provider lifecycle drift remains a separate tax-document reconciliation concern.

Issuance/readiness paths that require stronger write coordination keep their existing `Serializable` transactions. The in-transaction authority helpers also keep using the caller transaction so a write workflow does not accidentally create a second snapshot.

## What this guarantees

The read boundary prevents a historical legal verifier from combining source material from different committed database states while concurrent amendment, payment, or legal-document work is occurring. It also prevents a later provider lifecycle status change on a schema-version-6 terminal refund from rewriting the historical terminal refund authority that was frozen at issuance. It does not weaken tenant scope, immutable document fingerprints, predecessor continuity, bounded-history failure behavior, or reconciliation drift reporting.

Newly issued schema-version-2-through-5 commercial adjustment notes also have a separate versioned issue-time settlement-evidence ledger captured with the legal document. Historical chain verification prefers that frozen provider-neutral ledger instead of rebuilding issue-time authority from mutable current provider status. Once frozen capture begins in a source chain, every later commercial note must have frozen evidence, and a gap after frozen capture begins fails closed. Frozen payment membership must also remain monotonic across that captured suffix.

## What this does not guarantee

Pre-migration commercial adjustment notes are intentionally not backfilled because SF cannot truthfully reconstruct provider status that was never frozen at issuance. A verified source chain may therefore contain a leading pre-migration legacy prefix that still uses the bounded retained-payment fallback, followed by a contiguous frozen-evidence suffix. Snapshot consistency cannot manufacture missing historical issue-time facts for that legacy prefix, and schema version 6 can inherit only that unavoidable predecessor limitation when such legacy notes are present.

This boundary also does not claim to solve mixed/partial/non-standard-GST legal semantics, generic correction/void/reissue, jurisdiction review, live provider validation, or the repository's remaining production-environment validation gates.
