# Tax document retention and reconciliation

## Scope

SF retains issued Australian hospitality tax invoices and adjustment notes as immutable legal evidence while required for lawful tax, accounting, dispute, and record-keeping purposes. **Automatic deletion is disabled.** SF does not expose delete, void-in-place, or rewrite workflows for issued tax documents and does not infer disposal authority from document age alone.

PostgreSQL independently enforces that retention boundary for issued hospitality tax documents. Every in-place `UPDATE` of an issued tax invoice or adjustment note is rejected, and standalone deletion is rejected while the owning tenant booking remains retained. Controlled fixture or maintenance teardown is possible only when dependent legal documents and the owning booking are removed coherently in the same transaction; that database escape hatch is not a product deletion workflow or legal-disposal authority.

This is an operational fail-safe, not a recommendation to retain customer personal information forever. The product now supports narrowly scoped de-identification of an archived customer master profile only when that customer has no hospitality booking references. Booking-linked data and immutable legal/accounting evidence remain outside that workflow and require separate retention/disposal authority. See `docs/customer-data-lifecycle.md`.

## Reconciliation boundary

`/invoices/reconciliation` exposes an operator-triggered tenant-scoped point-in-time integrity review. Starting reconciliation is a same-origin authenticated POST and requires both `booking:read` and `payment:read` on the active organization.

The verifier walks the Australian tax-invoice and adjustment-note registers through their validated read boundaries. Tax invoices must pass immutable snapshot/material/party/pricing/fingerprint validation. Adjustment notes must also pass their schema-specific legal authority:

- schema 1: immutable source invoice plus the exact attributed full-refund identity, source, currency, money, and issue-time chronology;
- schemas 2 through 5: complete commercial source-chain, amendment, target-pricing, predecessor, chronology, effect, and issue-time settlement verification; and
- schema 6: complete commercial predecessor chain plus terminal predecessor continuity and exact frozen ordered refund-authority verification.

Schema-version-1 cancellation notes intentionally separate historical issuance authority from mutable current provider settlement. Issuance still requires one exact attributed `SUCCEEDED` full refund inside the serializable writer. After issuance, the legal document remains immutable and readable if the same Stripe refund later moves away from success; current `PaymentTransaction.status` is provider lifecycle truth, not a field frozen into the schema-version-1 legal snapshot. Reconciliation checks that exact linked refund separately and records `SETTLEMENT_DRIFT` against the affected adjustment-note number when current status is no longer `SUCCEEDED`.

Schema-version-6 cancellation-after-amendment snapshots already freeze an ordered set of exact cancellation refund transaction IDs, ordinals, amounts, and timestamps. Historical terminal refund authority reloads only those exact tenant-owned rows and re-proves structural identity, source attribution, money, and chronology; it does not depend on current `PaymentTransaction.status`. Reconciliation still maps the frozen IDs to current refund status and records per-document `SETTLEMENT_DRIFT`. Missing refund rows remain source/integrity failures rather than being mislabeled as provider lifecycle drift.

New commercial-amendment adjustment notes using schemas 2 through 5 now retain a separate versioned issue-time settlement-evidence ledger. Historical authority for those newly issued documents replays the frozen provider-neutral status/money/source evidence instead of treating later provider lifecycle changes as historical truth. Pre-migration commercial notes are intentionally not backfilled; their original provider status was not frozen at issuance and cannot be reconstructed truthfully. A commercial chain may therefore have a leading legacy prefix followed by a contiguous frozen-evidence suffix, and any missing evidence after frozen capture begins fails closed.

A settlement-drift result never rewrites, hides, voids, or deletes the issued adjustment note and does not invent a correction or replacement-refund workflow.

The synchronous verifier is capped at 5,000 combined legal documents. Above that limit SF fails closed and requires an offline/batched operational review rather than reporting a partial register as verified.

Because reconciliation is a point-in-time application read rather than a database snapshot held across every paginated query, the verifier compares register counts before, during, and after the scan. Concurrent legal-document issuance causes a `FAILED` result and the operator must rerun it.

A completed reconciliation writes one tenant-scoped `AuditEvent` summary using `payment.tax-document-reconciliation.completed`. Audit schema version 2 stores only jurisdiction, status, UTC check time, exact document counts, normalized failure codes, and the count of occurrences for each failure code. It deliberately excludes document numbers, customer PII, provider/payment references, credentials, raw snapshots, and fingerprints. Historical schema-version-1 audit summaries remain readable; because they stored only unique failure codes, SF does not invent occurrence counts for those older records.

Reconciliation never mutates issued documents, payment state, booking state, provider state, or accounting evidence.

## Australian record-retention and privacy references

ATO GST guidance in GSTR 2006/3 describes a record-retention period that can extend beyond five years when an assessment period of review or a refreshed review period remains relevant. SF therefore treats five years as a minimum record-keeping reference only, not as automatic disposal authority.

Australian Privacy Principle 11 separately requires covered entities to consider whether they are still permitted to retain personal information and, subject to legal-retention exceptions, to take reasonable steps to destroy or de-identify personal information that is no longer needed. SF's current bookingless customer-profile workflow is only one narrow lifecycle boundary; booking-linked copies and legally retained records remain subject to tenant legal/privacy review.

## Operational use

Run reconciliation after material tax-document migrations, before accounting exports used for period close, and whenever document-integrity concerns are investigated. A `VERIFIED` result means the current tenant register passed the implemented evidence contracts at that point in time. It is not legal advice and does not replace external accounting reconciliation, statutory filing, privacy review, or jurisdiction-specific legal approval.

## Remaining legal-document work

The current reconciliation boundary includes increasing/decreasing mixed-direction commercial adjustments, terminal cancellation after commercial amendments, immutable issue-time settlement evidence for newly issued commercial adjustments, per-document current refund drift for schemas 1 and 6, and durable secret-safe failure occurrence counts in reconciliation history. Remaining work includes the unavoidable legacy limitation for pre-migration commercial documents, mixed/partial/non-standard-GST adjustment rules, generic correction/void/reissue, broader booking-linked customer-data disposal/de-identification beyond the safe bookingless customer-profile boundary, durable customer re-authentication/email delivery, Unicode-safe deterministic PDF fonts, live Node 24/Prisma/PostgreSQL validation, and legal review.
