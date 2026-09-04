# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, PDF projection, and delivery so no browser action or mutable customer/pricing record can become legal-document authority by accident.

The implemented issuance foundation currently supports only the narrow Australian `TAX_INVOICE` contract documented in `docs/australian-tax-invoice-contract.md`.

## Persistence

`HospitalityInvoicePreparation` freezes the accepted pricing evidence, issuer fingerprint, immutable recipient snapshot/fingerprint, exact money, and document preparation fingerprint.

`HospitalityInvoiceNumberSequence` owns the next integer sequence by `organizationId`, `jurisdictionCode`, and `documentType`. The first supported tuple is `AU / TAX_INVOICE`. Allocation happens in the same serializable transaction that creates the issued invoice, so a failed transaction cannot commit only the sequence increment.

`HospitalityIssuedInvoice` stores the committed immutable document identity and evidence: tenant/booking/preparation/pricing/issuer identities, jurisdiction/document number/sequence, issuing actor and timestamp, exact minor-unit money, source fingerprints, and the complete immutable snapshot used by renderers.

PostgreSQL composite foreign keys independently prevent cross-tenant or cross-booking references. Unique constraints prevent two issued documents for one preparation and prevent duplicate tenant/jurisdiction numbers or sequence values.

## Server authority

`issueHospitalityAustralianTaxInvoice` requires `payment:manage`. First issuance passes the shared Australian preparation-verification boundary, which validates immutable preparation/recipient/issuer/pricing evidence, exact money, and current accepted booking commercial state. The service derives sequence, number, issue time, legal snapshots, and document fingerprint server-side.

The caller cannot submit legal/tax money, invoice number, sequence, issuer, recipient, tax lines, or document fingerprint as authority.

A retry first looks for the already-issued `(organizationId, preparationId)` record and validates its immutable snapshot/fingerprint. This preserves idempotency even after later booking changes. A not-yet-issued stale preparation is rejected before sequence allocation.

## Read, rendering, PDF, accounting export, and delivery

Authenticated staff invoice reads require both `booking:read` and `payment:read`. Issuance remains a separate `payment:manage` operation. Invoice-history reads independently verify that the requested booking exists inside the active organization before counting or returning issued documents.

The booking workspace shows the latest documents and links to a dedicated paginated history. `/invoices` provides a tenant-wide paginated register. Its bounded accounting CSV export revalidates each persisted document and uses exact currency strings; it excludes mutable customer display data, credentials, provider/card references, idempotency keys, and internal payment references.

Both authenticated and capability-owned public invoice surfaces render only after immutable snapshot/material-column/fingerprint validation. The customer JSON projection excludes internal IDs, counters, fingerprints, actors, provider references, and credentials.

SF now also generates a deterministic server-side PDF projection from that verified customer document. Authenticated downloads re-enter the existing tenant/permission read boundary. Public downloads use a same-origin POST so the encrypted booking capability remains out of URLs and reuse the public booking ownership/principal/document checks. See `docs/invoice-pdf.md`.

The current deterministic PDF renderer is deliberately fail-closed: it supports AU/AUD documents whose legal text is losslessly representable by the standard PDF WinAnsi font contract. Unsupported scripts are never transliterated or silently replaced. Universal Unicode-safe PDF font embedding therefore remains an open rendering boundary.

Browser Print/Save remains a convenience over the verified immutable record and is separate from the deterministic PDF artifact.

The existing payment receipt remains separate settlement evidence and must not be transformed into a tax invoice by UI wording alone.

## Corrections

Issued rows are historical evidence and must not be edited to reflect later refunds or commercial amendments. Correction/adjustment-note/reissue work must create its own immutable linked document lifecycle and numbering rules.

Durable re-authenticated customer history, email delivery/resend, adjustment documents, broader taxability, retention/reconciliation policy, full production-toolchain validation, and legal review remain separate production work.
