# Commercial adjustment issue-time settlement evidence

Australian hospitality commercial adjustment notes now retain a provider-neutral copy of the exact payment ledger that was used to establish settlement when the legal document was issued.

## Why this exists

Commercial adjustment-note schemas 2 through 5 historically rebuilt settlement from retained `PaymentTransaction` rows. That reconstruction was bounded and issue-time filtered, but `PaymentTransaction.status` is provider lifecycle state and may legitimately change after issuance. A later provider update must not redefine whether an already-issued immutable adjustment note had settlement authority at its original issue time.

The settlement evidence introduced by migration `20260924222000-hospitality-commercial-settlement-evidence` separates those responsibilities:

- historical legal authority replays the frozen issue-time ledger;
- current provider lifecycle remains mutable operational truth; and
- tax-document reconciliation continues to report current settlement drift without rewriting, hiding, or invalidating the issued document.

## Capture boundary

An `AFTER INSERT` PostgreSQL trigger runs only for commercial adjustment notes using document schema versions 2, 3, 4, or 5. The trigger executes inside the same transaction that inserts the adjustment note.

For that tenant, booking, source invoice, and source adjustment ordinal, it copies only:

- base booking payment rows whose `commercialAmendmentId` is null; and
- payment rows linked to commercial amendments already present in the legal source chain through the new adjustment note.

Rows created after the legal document `issuedAt` are excluded. The evidence is bounded to 5,000 transactions, matching the existing historical legal-payment safety limit. Issuance fails closed if the bounded evidence cannot be captured.

The parent evidence record stores schema version `1`, the exact adjustment-note/amendment/source identities, issue time, and expected transaction count. Child rows freeze payment transaction identity, amendment attribution, kind, issue-time status, provider identity, source attribution, currency, amount, and original creation time.

Provider credentials, webhook payloads, customer PII, and secrets are not copied.

## Historical verification

`loadHospitalityFrozenCommercialSettlementEvidence` reads the evidence under the exact organization, booking, and source-invoice scope. It validates the evidence header against the immutable adjustment-note identity, requires schema version 1, enforces the 5,000-row limit, checks exact transaction count, rejects duplicate transaction identities, verifies tenant scope and chronology, and rejects payment rows attributed to commercial amendments outside the legal chain prefix.

Legacy documents can exist only as a leading prefix before frozen capture begins. Once any commercial adjustment note in a source chain has frozen settlement evidence, every later commercial adjustment note in that chain must also have frozen evidence. A gap after capture begins fails closed instead of silently falling back to mutable current payment state. This preserves truthful pre-migration compatibility without allowing a missing post-migration evidence record to weaken historical authority.

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` prefers that frozen evidence for each adjustment note and runs the existing provider-neutral settlement derivation against the frozen rows. Later changes to current `PaymentTransaction.status` therefore do not change historical authority for notes that have frozen evidence.

Existing commercial adjustment notes are intentionally **not backfilled**. Their original provider statuses cannot be reconstructed truthfully after the fact. A legacy note without frozen evidence continues through the previous bounded retained-payment fallback and remains subject to the documented legacy settlement-evidence limitation.

## Database integrity

The evidence tables are immutable after capture. Parent inserts must match a real tenant-scoped commercial adjustment note and must occur with the note issuance window. Child rows are linked to their parent evidence by tenant and booking scope. Later inserts cannot silently extend valid evidence because the parent transaction count is immutable and historical reads require an exact count match.

This boundary is supplemental legal evidence; it does not replace the immutable adjustment-note snapshot, source invoice, commercial amendment, target pricing, predecessor-chain, chronology, or document-fingerprint checks.

## Reconciliation

Current settlement reconciliation deliberately continues to read current payment lifecycle state. If a provider later moves a payment or refund away from the issue-time successful state, reconciliation may report `SETTLEMENT_DRIFT`, while the issued adjustment note remains historically verifiable from its frozen evidence.

This is the same separation already used for terminal schema-version-6 refund authority: immutable issue-time legal evidence and mutable provider lifecycle are related but are not the same source of truth.

## Deliberate boundaries

This migration closes the mutable-status dependency for **newly issued** schema-version-2-through-5 commercial adjustment notes. It does not fabricate historical evidence for pre-migration documents and does not claim that those legacy rows can be made independent of later provider-status changes without externally authoritative historical records.

Mixed taxability, partial or non-standard-GST adjustments, generic correction/void/reissue, other jurisdictions, durable customer re-authentication and email delivery, universal Unicode-safe PDF rendering, reviewed retention/disposal, live Node 24/Prisma/PostgreSQL execution, live-provider verification, and jurisdiction-specific legal review remain separate production gates.
