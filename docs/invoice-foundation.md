# Invoice and legal pricing evidence foundation

## Status

SF has a real narrow Australian hospitality tax-document lifecycle rather than only future invoice preparation. The implemented evidence chain is:

1. append-only `HospitalityBookingPricingEvidence` for accepted commercial lines and exact money;
2. versioned tenant-owned `InvoiceIssuerProfile` snapshots;
3. immutable `HospitalityInvoicePreparation` with frozen recipient evidence;
4. Australian readiness validation;
5. serializable tenant/jurisdiction numbering and immutable `HospitalityIssuedInvoice` evidence;
6. authenticated and capability-owned tax-invoice rendering/history;
7. deterministic tax-invoice PDF projection for losslessly supported legal text;
8. a narrow full-cancellation decreasing-adjustment lifecycle with separately numbered immutable `HospitalityIssuedAdjustmentNote` evidence;
9. authenticated and capability-owned adjustment-note rendering plus deterministic PDF projection;
10. tenant registers plus bounded exact-money accounting CSV exports for both tax invoices and adjustment notes; and
11. tenant-scoped live integrity reconciliation plus an explicit no-automatic-disposal retention rule for issued legal documents.

The customer-safe payment receipt remains separate settlement evidence and must never be relabeled as a regulated invoice or adjustment document.

## Immutable booking pricing evidence

`HospitalityBookingPricingEvidence` is append-only and scoped by organization/booking. It freezes accepted stay/scope/selections, exact currency and aggregate money, pricing fingerprint, and a schema-versioned nightly/tax/fee/add-on breakdown. Booking confirmation and accepted commercial changes write authoritative evidence inside the protected transaction rather than trusting browser totals.

Older bookings can legitimately have no immutable pricing evidence. SF fails closed instead of rebuilding legal history from today's mutable rate/tax configuration.

## Issuer, recipient, and preparation evidence

`InvoiceIssuerProfile` stores normalized versioned issuer identity and registration declarations with a deterministic fingerprint. Creating issuer evidence requires `organization-settings:manage`. Registration values are tenant declarations; the Australian contract validates ABN structure but does not currently prove live ABN/GST status externally.

`HospitalityInvoicePreparation` binds one accepted pricing-evidence record to one issuer version, one immutable individual/business recipient snapshot, exact money, and source fingerprints. `prepareHospitalityInvoice` requires `payment:manage` and derives authority server-side inside the tenant boundary. Exact retries are idempotent; changed issuer/recipient/commercial evidence creates new immutable preparation rather than rewriting history.

## Australian readiness, issuance, and adjustment evidence

The first jurisdiction contract is documented in `docs/australian-tax-invoice-contract.md`. It deliberately supports AU/AUD, structurally valid matching ABN/GST declarations, one persisted GST tax line, and fully taxable standard-GST money. Buyer identity is required at the AUD 1,000 threshold.

`assessHospitalityAustralianTaxInvoiceReadiness` verifies preparation, booking, recipient, issuer, pricing, fingerprints, ownership, and exact money. `issueHospitalityAustralianTaxInvoice` then allocates the tenant/jurisdiction/document-type sequence and immutable issued record in one serializable transaction. Browser input cannot choose legal money, number, issuer, recipient, tax data, sequence, issue time, or fingerprint.

Issued records remain historical evidence even after later booking changes. They are never edited to reflect a refund or commercial amendment.

The first adjustment contract is documented in `docs/australian-adjustment-notes.md`. It supports only a verified source tax invoice followed by full booking cancellation and one attributed successful full refund. SF creates a separate `AU / ADJUSTMENT_NOTE` number and immutable document rather than rewriting the original invoice. Partial/multiple refunds, commercial-amendment adjustments, and mixed taxability remain unsupported and fail closed.

## Read, PDF, accounting, retention, and reconciliation projections

Authenticated issued-document reads require `booking:read` plus `payment:read`. Public reads are limited to the existing encrypted booking capability and independently verify booking ownership and an unexpired matching public principal. Adjustment-note reads additionally revalidate their source tax invoice.

Renderers revalidate immutable material columns and fingerprints before deriving customer-safe output. Deterministic server-side PDF generation uses only verified customer projections, exact integer money, fixed A4 layout/object ordering, and no current-time/random/runtime metadata. It fails closed when legal text cannot be represented losslessly by the current WinAnsi standard-font contract; broader Unicode-safe embedded-font support remains open. See `docs/invoice-pdf.md`.

The tenant-wide tax-invoice and adjustment-note registers are independently paginated. Accounting CSV generation revalidates every included legal document, adjustment exports also revalidate source tax invoices, exact decimal money strings are used, mutable/secret/provider/refund-reference data is excluded, and synchronous exports larger than 5,000 rows fail closed rather than returning partial data.

`/invoices/reconciliation` applies the same tenant authorization and validated read boundaries across the complete current AU register, with a 5,000-document synchronous bound and before/during/after count checks so concurrent issuance cannot be reported as a stable verification. The retention/disposal boundary is documented in `docs/tax-document-retention-and-reconciliation.md`: SF performs no automatic deletion or in-place rewrite of issued legal documents, but this is not a permanent-retention legal claim. Any future disposal/de-identification workflow must establish tax, assessment/review-period, privacy, and jurisdictional authority first.

## Remaining production boundaries

The Phase 12 legal-document item remains open for:

- richer mixed-taxability semantics when product scope requires them;
- partial-refund, multiple-refund, commercial-amendment, credit/correction/void/reissue rules beyond the currently supported full-cancellation decreasing adjustment;
- universal Unicode-safe deterministic PDF rendering;
- durable re-authenticated customer history, email delivery, and resend beyond the current public recovery capability;
- a reviewed customer-data disposal/de-identification lifecycle and any future accounting-provider integration;
- live issuer-registration verification if legal/product requirements demand it;
- complete Node 24/Prisma/PostgreSQL production validation; and
- jurisdiction/legal review.

## Validation boundary

Dependency-free suites cover issuer/recipient/preparation identities, Australian ABN/GST/readiness rules, issued-document integrity, tax-invoice and adjustment-note accounting CSV behavior, deterministic PDF generation, and the retention/reconciliation result contract. Disposable PostgreSQL suites cover tenant permissions, cross-tenant denial, issuer/preparation persistence, issuance concurrency/idempotency, stale-state rejection, and audit behavior when the guarded database harness can be executed.

Full repository and live-database validation require the supported Node 24 dependency checkout and an explicitly disposable PostgreSQL target. GitHub Actions are not used.
