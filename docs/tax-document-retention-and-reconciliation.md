# Tax document retention and reconciliation

## Scope

SF retains issued Australian hospitality tax invoices and adjustment notes as immutable legal evidence while required for lawful tax, accounting, dispute, and record-keeping purposes. **Automatic deletion is disabled.** SF does not expose delete, void-in-place, or rewrite workflows for issued tax documents and does not infer disposal authority from document age alone.

This is an operational fail-safe, not a recommendation to retain customer personal information forever. A future disposal or de-identification workflow requires a separate legal/product contract that considers applicable tax-record and privacy obligations.

## Reconciliation boundary

`/invoices/reconciliation` exposes an operator-triggered tenant-scoped point-in-time integrity review. Starting reconciliation is a same-origin authenticated POST and requires both `booking:read` and `payment:read` on the active organization.

The verifier walks the Australian tax-invoice and adjustment-note registers through their validated read boundaries. Tax invoices must pass immutable snapshot/material/party/pricing/fingerprint validation. Adjustment notes must also pass their schema-specific legal authority:

- schema 1: immutable source invoice plus attributed full refund;
- schemas 2 through 5: complete commercial source-chain, amendment, target-pricing, predecessor, chronology, effect, and issue-time settlement verification; and
- schema 6: complete commercial predecessor chain plus terminal predecessor continuity, issue-time zero settlement, and exact frozen ordered refund-authority verification.

The synchronous verifier is capped at 5,000 combined legal documents. Above that limit SF fails closed and requires an offline/batched operational review rather than reporting a partial register as verified.

Because reconciliation is a point-in-time application read rather than a database snapshot held across every paginated query, the verifier compares register counts before, during, and after the scan. Concurrent legal-document issuance causes a `FAILED` result and the operator must rerun it.

A completed reconciliation writes one tenant-scoped `AuditEvent` summary using `payment.tax-document-reconciliation.completed`. The audit stores only jurisdiction, status, UTC check time, exact document counts, and normalized failure codes. It excludes customer PII, provider/payment references, credentials, raw snapshots, and fingerprints.

Reconciliation never mutates issued documents, payment state, booking state, provider state, or accounting evidence.

## Australian record-retention and privacy references

ATO GST guidance in GSTR 2006/3 describes a record-retention period that can extend beyond five years when an assessment period of review or a refreshed review period remains relevant. SF therefore treats five years as a minimum record-keeping reference only, not as automatic disposal authority.

Australian Privacy Principle 11 separately requires covered entities to consider whether they are still permitted to retain personal information and, subject to legal-retention exceptions, to take reasonable steps to destroy or de-identify personal information that is no longer needed. SF's current no-automatic-deletion rule must therefore be paired with tenant legal/privacy review until a product disposal lifecycle is implemented.

## Operational use

Run reconciliation after material tax-document migrations, before accounting exports used for period close, and whenever document-integrity concerns are investigated. A `VERIFIED` result means the current tenant register passed the implemented evidence contracts at that point in time. It is not legal advice and does not replace external accounting reconciliation, statutory filing, privacy review, or jurisdiction-specific legal approval.

## Remaining legal-document work

The current reconciliation boundary now includes increasing/decreasing mixed-direction commercial adjustments and terminal cancellation after commercial amendments. Remaining work includes mixed/partial/non-standard-GST adjustment rules, generic correction/void/reissue, a reviewed customer-data disposal/de-identification lifecycle, durable customer re-authentication/email delivery, Unicode-safe deterministic PDF fonts, live Node 24/Prisma/PostgreSQL validation, and legal review.
