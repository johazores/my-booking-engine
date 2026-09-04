# Tax document retention and reconciliation

## Scope

SF retains issued Australian hospitality tax invoices and adjustment notes as immutable legal evidence. The current product policy is deliberately conservative: **automatic deletion is disabled and issued legal documents are retained indefinitely**. SF does not currently expose a delete, void-in-place, or rewrite workflow for an issued tax invoice or adjustment note.

This policy avoids encoding a fixed deletion date that could be wrong when an Australian record must be kept beyond the ordinary minimum period because an assessment, amendment, objection, review, or other statutory requirement remains open. A future disposal feature requires a separate legal and product contract; it must never infer deletion authority from document age alone.

## Reconciliation boundary

`/invoices/reconciliation` performs a real tenant-scoped point-in-time integrity review. Access requires both `booking:read` and `payment:read` on the active organization.

The verifier walks the complete Australian tax-invoice and adjustment-note registers through their existing validated read boundaries. Tax invoices must pass immutable snapshot, material-column, party/pricing evidence, and document-fingerprint validation. Adjustment notes must also pass their immutable snapshot/material-column/fingerprint checks and the persisted source-tax-invoice linkage check.

The synchronous verifier is capped at 5,000 combined legal documents. Above that limit SF fails closed and requires an offline/batched operational review rather than reporting a partial register as verified.

Because reconciliation is a live application read rather than a database snapshot held across every paginated query, the verifier compares register counts before, during, and after the scan. If legal-document issuance changes the register during verification, the result is `FAILED` with a concurrent-change reason and the operator must rerun it. Issued documents have no product mutation/delete workflow, so a stable count plus the immutable per-document checks gives the current application boundary a deterministic reconciliation result without blocking normal invoice issuance for the duration of the scan.

Reconciliation does not mutate documents, payment state, booking state, or accounting evidence. It does not call payment providers and does not expose customer PII, provider references, credentials, or raw persisted snapshots in its result.

## Australian record-retention reference

Australian tax law generally requires relevant GST records to be retained for at least five years, with longer retention possible where review periods or later amendments extend the requirement. SF therefore treats five years as a minimum reference only, not as automated deletion authority. The current indefinite-retention policy is intentionally safer until a jurisdiction-reviewed disposal lifecycle is implemented.

## Operational use

Run reconciliation after material tax-document migrations, before accounting exports used for period close, and whenever document-integrity concerns are investigated. A `VERIFIED` result means the current tenant register passed the implemented evidence contracts at that point in time. It is not legal advice and does not replace external accounting reconciliation, statutory filing, or jurisdiction-specific review.

## Remaining legal-document work

This closes the product's explicit retention/reconciliation-policy gap for the current AU hospitality document scope. It does not close broader partial/multiple/commercial-amendment adjustment contracts, durable customer re-authentication/email delivery, Unicode-safe deterministic PDF fonts, live Node 24/PostgreSQL validation, or legal review.
