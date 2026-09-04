# Tax document retention and reconciliation

## Scope

SF retains issued Australian hospitality tax invoices and adjustment notes as immutable legal evidence while they are required for the tenant's lawful tax, accounting, dispute, and record-keeping purposes. **Automatic deletion is disabled.** SF does not expose a delete, void-in-place, or rewrite workflow for an issued tax invoice or adjustment note, and it does not infer disposal authority from document age alone.

This is an operational fail-safe, not a recommendation to retain customer personal information forever. A future disposal or de-identification workflow requires a separate legal and product contract that considers both the applicable tax record period and privacy obligations before changing retained legal-document evidence.

## Reconciliation boundary

`/invoices/reconciliation` exposes an explicit operator-triggered tenant-scoped point-in-time integrity review. Opening or refreshing the page does **not** run the potentially expensive register scan. Starting a reconciliation is a same-origin authenticated POST and requires both `booking:read` and `payment:read` on the active organization.

The verifier walks the complete Australian tax-invoice and adjustment-note registers through their existing validated read boundaries. Tax invoices must pass immutable snapshot, material-column, party/pricing evidence, and document-fingerprint validation. Adjustment notes must also pass their immutable snapshot/material-column/fingerprint checks and persisted source-tax-invoice linkage. Commercial schema-version-2/3 adjustments are accepted only after the selected rows are proven members of the complete verified source chain, including predecessor, amendment, target-pricing, chronology, and standard-GST authority.

The synchronous verifier is capped at 5,000 combined legal documents. Above that limit SF fails closed and requires an offline/batched operational review rather than reporting a partial register as verified.

Because reconciliation is a point-in-time application read rather than a database snapshot held across every paginated query, the verifier compares register counts before, during, and after the scan. If legal-document issuance changes the register during verification, the result is `FAILED` with a concurrent-change reason and the operator must rerun it. Issued documents have no product mutation/delete workflow, so a stable count plus the immutable per-document checks gives the current application boundary a deterministic reconciliation result without blocking normal invoice issuance for the duration of the scan.

A completed reconciliation writes one tenant-scoped `AuditEvent` summary using `payment.tax-document-reconciliation.completed`. The audit stores only jurisdiction, status, UTC check time, exact document counts, and normalized failure codes. It deliberately excludes document numbers involved in failures, customer PII, provider/payment references, credentials, raw snapshots, and fingerprints. `/invoices/reconciliation` reads that history through the same `booking:read` + `payment:read` authorization boundary with pagination and fails closed if persisted audit payloads do not match the versioned summary contract.

Reconciliation never mutates issued documents, payment state, booking state, provider state, or accounting evidence. The only write is the safe operator audit record after a bounded scan completes.

## Australian record-retention and privacy references

ATO GST guidance in GSTR 2006/3 describes a record-retention period that can extend beyond five years when an assessment period of review or a refreshed review period remains relevant. SF therefore treats five years as a minimum record-keeping reference only, not as automatic disposal authority.

Australian Privacy Principle 11 separately requires covered entities to consider whether they are still permitted to retain personal information and, subject to legal-retention exceptions, to take reasonable steps to destroy or de-identify personal information that is no longer needed. SF's current no-automatic-deletion rule must therefore be paired with tenant legal/privacy review until a product disposal lifecycle is implemented.

## Operational use

Run reconciliation after material tax-document migrations, before accounting exports used for period close, and whenever document-integrity concerns are investigated. A `VERIFIED` result means the current tenant register passed the implemented evidence contracts at that point in time. It is not legal advice and does not replace external accounting reconciliation, statutory filing, privacy review, or jurisdiction-specific legal approval.

## Remaining legal-document work

This closes the product's explicit retention/reconciliation-policy gap for the current AU hospitality document scope by defining a fail-closed retention rule, a real operator-triggered integrity-reconciliation surface, and auditable result history. It does not close increasing or cancellation-after-amendment semantics, partial/non-standard-GST and mixed-taxability adjustment rules, generic correction/void/reissue, a reviewed customer-data disposal/de-identification lifecycle, durable customer re-authentication/email delivery, Unicode-safe deterministic PDF fonts, live Node 24/Prisma/PostgreSQL validation, or legal review.
