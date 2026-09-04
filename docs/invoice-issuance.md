# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, PDF projection, adjustment documents, and delivery so no browser action or mutable customer/pricing record can become legal-document authority by accident.

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

## Read, rendering, PDF, accounting export, and delivery

Authenticated staff invoice reads require both `booking:read` and `payment:read`. Issuance remains a separate `payment:manage` operation. Invoice-history reads independently verify that the requested booking exists inside the active organization before counting or returning issued documents.

The booking workspace shows the latest documents and links to a dedicated paginated history. `/invoices` provides a tenant-wide paginated tax-invoice register. Its bounded accounting CSV export revalidates each persisted invoice and uses exact currency strings; it excludes mutable customer display data, credentials, provider/card references, idempotency keys, and internal payment references.

Both authenticated and capability-owned public tax-document surfaces render only after immutable snapshot/material-column/fingerprint validation. The customer projections exclude internal IDs, counters, fingerprints, actors, refund/provider references, and credentials.

SF generates a deterministic server-side PDF projection for verified tax invoices. Authenticated downloads re-enter the existing tenant/permission read boundary. Public downloads use a same-origin POST so the encrypted booking capability remains out of URLs and reuse the public booking ownership/principal/document checks. See `docs/invoice-pdf.md`.

The current deterministic invoice PDF renderer is deliberately fail-closed: it supports AU/AUD documents whose legal text is losslessly representable by the standard PDF WinAnsi font contract. Unsupported scripts are never transliterated or silently replaced. Universal Unicode-safe PDF font embedding therefore remains an open rendering boundary.

Browser Print/Save remains a convenience over the verified immutable record and is separate from the deterministic PDF artifact. Adjustment notes currently support verified authenticated/public rendering and Print/Save but do not yet have a deterministic SF-generated PDF artifact.

The existing payment receipt remains separate settlement evidence and must not be transformed into a tax invoice or adjustment note by UI wording alone.

## Corrections and adjustment notes

Issued tax invoices are historical evidence and are never edited to reflect later refunds or commercial changes.

SF now implements one explicit decreasing-adjustment lifecycle: a verified Australian tax invoice can receive a separately numbered immutable adjustment note after a full booking cancellation and one attributed successful full refund. The service independently revalidates tenant scope, booking cancellation/refund state, source-invoice evidence, exact refund authority, standard-GST money, separate numbering, and immutable document fingerprints before issuance. Staff cannot enter an arbitrary reason or legal amount.

Authenticated reads require `booking:read` + `payment:read`; issuance requires `payment:manage`. Capability-owned public booking recovery can read the customer-safe adjustment document after ownership/principal/tenant/source-invoice verification.

Partial refunds, multiple-refund aggregation, commercial-amendment price corrections/compensation, mixed taxability, generic reissue/void workflows, and other adjustment reasons remain unsupported and must receive separate immutable contracts rather than mutating existing issued documents.

Durable re-authenticated customer history beyond the current recovery capability, email delivery/resend, deterministic adjustment-note PDFs, broader taxability, adjustment-note accounting export treatment, explicit retention/reconciliation policy, full production-toolchain validation, automated statutory delivery-deadline enforcement, and legal review remain separate production work.