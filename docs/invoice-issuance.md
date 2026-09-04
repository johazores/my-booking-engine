# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, PDF projection, adjustment documents, accounting export, and delivery so no browser action or mutable customer/pricing record can become legal-document authority by accident.

The implemented issuance foundation currently supports the narrow Australian `TAX_INVOICE` contract documented in `docs/australian-tax-invoice-contract.md` plus the full-booking-cancellation decreasing-adjustment contract in `docs/australian-adjustment-notes.md`.

## Persistence

`HospitalityInvoicePreparation` freezes the accepted pricing evidence, issuer fingerprint, immutable recipient snapshot/fingerprint, exact money, and document preparation fingerprint.

`HospitalityInvoiceNumberSequence` owns the next integer sequence by `organizationId`, `jurisdictionCode`, and `documentType`. The supported tuples are `AU / TAX_INVOICE` and `AU / ADJUSTMENT_NOTE`. Allocation happens in the same serializable transaction that creates the issued document, so a failed transaction cannot commit only the sequence increment.

`HospitalityIssuedInvoice` stores the committed immutable tax-invoice identity and evidence: tenant/booking/preparation/pricing/issuer identities, jurisdiction/document number/sequence, issuing actor and timestamp, exact minor-unit money, source fingerprints, and the complete immutable snapshot used by renderers.

`HospitalityIssuedAdjustmentNote` separately stores immutable decreasing-adjustment evidence for the currently supported full booking cancellation workflow, including the exact source tax invoice and successful refund transaction.

PostgreSQL composite foreign keys independently prevent cross-tenant or cross-booking references. Unique constraints prevent duplicate tenant/document numbers, sequence values, document fingerprints, or reuse of one refund transaction for multiple adjustment notes.

## Server authority

`issueHospitalityAustralianTaxInvoice` requires `payment:manage`. First issuance passes the shared Australian preparation-verification boundary, which validates immutable preparation/recipient/issuer/pricing evidence, exact money, and current accepted booking commercial state. The service derives sequence, number, issue time, legal snapshots, and document fingerprint server-side.

The caller cannot submit legal/tax money, invoice number, sequence, issuer, recipient, tax lines, or document fingerprint as authority.

A retry first looks for the already-issued `(organizationId, preparationId)` record and validates its immutable snapshot/fingerprint. This preserves idempotency even after later booking changes. A not-yet-issued stale preparation is rejected before sequence allocation.

## Read, rendering, PDF, accounting export, retention, reconciliation, and delivery

Authenticated staff tax-document reads require both `booking:read` and `payment:read`. Issuance remains a separate `payment:manage` operation. Invoice and adjustment-note register/history reads independently verify tenant/resource scope before returning documents.

The booking workspace shows recent documents and links to dedicated document history. `/invoices` provides the tenant-wide paginated tax-invoice register, while `/invoices/adjustments` provides the tenant-wide paginated adjustment-note register.

Tax-invoice and adjustment-note accounting CSV exports are server-generated only after every included immutable document passes snapshot/material-column/fingerprint validation; adjustment rows additionally revalidate their linked source tax invoice. Both exports use exact currency strings and exclude mutable customer display data, credentials, provider/card references, idempotency keys, and internal payment/refund references. Each synchronous export is capped at 5,000 rows and fails closed rather than returning a partial dataset.

`/invoices/reconciliation` provides a read-only tenant-scoped integrity check over the complete current AU legal-document register. It requires `booking:read` plus `payment:read`, reuses the same document validation boundaries, validates adjustment-note source links, is capped at 5,000 combined documents, and fails closed if the register changes while the paginated scan is in progress. The retention/disposal boundary is documented in `docs/tax-document-retention-and-reconciliation.md`: issued legal documents are never automatically deleted or rewritten, and any future disposal/de-identification workflow requires separate tax, review-period, privacy, and legal authority.

Authenticated and capability-owned public tax-document surfaces render only after immutable snapshot/material-column/fingerprint validation. Customer projections exclude internal IDs, counters, fingerprints, actors, refund/provider references, and credentials.

SF generates deterministic server-side PDF projections for verified tax invoices and verified supported cancellation adjustment notes. Authenticated downloads re-enter the existing tenant/permission read boundaries. Public downloads use same-origin POST so the encrypted booking capability remains out of URLs and reuse the public booking ownership/principal/document checks. See `docs/invoice-pdf.md`.

The deterministic PDF renderers are deliberately fail-closed: they support current AU/AUD documents whose legal text is losslessly representable by the standard PDF WinAnsi font contract. Unsupported scripts are never transliterated or silently replaced. Universal Unicode-safe PDF font embedding remains an open rendering boundary.

Browser Print/Save remains a convenience over the verified immutable record and is separate from deterministic PDF artifact generation.

The existing payment receipt remains separate settlement evidence and must not be transformed into a tax invoice or adjustment note by UI wording alone.

## Corrections and adjustment notes

Issued tax invoices are historical evidence and are never edited to reflect later refunds or commercial changes.

SF implements one explicit decreasing-adjustment lifecycle: a verified Australian tax invoice can receive a separately numbered immutable adjustment note after a full booking cancellation and one attributed successful full refund. The service independently revalidates tenant scope, booking cancellation/refund state, source-invoice evidence, exact refund authority, standard-GST money, separate numbering, and immutable document fingerprints before issuance. Staff cannot enter an arbitrary reason or legal amount.

Authenticated reads require `booking:read` + `payment:read`; issuance requires `payment:manage`. Capability-owned public booking recovery can read and download the customer-safe adjustment document after ownership/principal/tenant/source-invoice verification.

Partial refunds, multiple-refund aggregation, commercial-amendment price corrections/compensation, mixed taxability, generic reissue/void workflows, and other adjustment reasons remain unsupported and must receive separate immutable contracts rather than mutating existing issued documents.

Durable re-authenticated customer history beyond the current recovery capability, email delivery/resend, broader taxability, a reviewed customer-data disposal/de-identification lifecycle, universal Unicode-safe deterministic PDF rendering, full production-toolchain validation, automated statutory delivery-deadline enforcement, and legal review remain separate production work.
