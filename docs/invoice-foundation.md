# Invoice and legal pricing evidence foundation

## Status

SF now has a real narrow Australian hospitality tax-invoice lifecycle rather than only future invoice preparation. The implemented evidence chain is:

1. append-only `HospitalityBookingPricingEvidence` for accepted commercial lines and exact money;
2. versioned tenant-owned `InvoiceIssuerProfile` snapshots;
3. immutable `HospitalityInvoicePreparation` with frozen recipient evidence;
4. Australian readiness validation;
5. serializable tenant/jurisdiction numbering and immutable `HospitalityIssuedInvoice` evidence;
6. authenticated and capability-owned document rendering/history;
7. deterministic PDF projection for losslessly supported legal text; and
8. tenant register plus bounded accounting CSV export.

The customer-safe payment receipt remains separate settlement evidence and must never be relabeled as a regulated invoice.

## Immutable booking pricing evidence

`HospitalityBookingPricingEvidence` is append-only and scoped by organization/booking. It freezes accepted stay/scope/selections, exact currency and aggregate money, pricing fingerprint, and a schema-versioned nightly/tax/fee/add-on breakdown. Booking confirmation and accepted commercial changes write authoritative evidence inside the protected transaction rather than trusting browser totals.

Older bookings can legitimately have no immutable pricing evidence. SF fails closed instead of rebuilding legal history from today's mutable rate/tax configuration.

## Issuer, recipient, and preparation evidence

`InvoiceIssuerProfile` stores normalized versioned issuer identity and registration declarations with a deterministic fingerprint. Creating issuer evidence requires `organization-settings:manage`. Registration values are tenant declarations; the Australian contract validates ABN structure but does not currently prove live ABN/GST status externally.

`HospitalityInvoicePreparation` binds one accepted pricing-evidence record to one issuer version, one immutable individual/business recipient snapshot, exact money, and source fingerprints. `prepareHospitalityInvoice` requires `payment:manage` and derives authority server-side inside the tenant boundary. Exact retries are idempotent; changed issuer/recipient/commercial evidence creates new immutable preparation rather than rewriting history.

## Australian readiness and issuance

The first jurisdiction contract is documented in `docs/australian-tax-invoice-contract.md`. It deliberately supports AU/AUD, structurally valid matching ABN/GST declarations, one persisted GST tax line, and fully taxable standard-GST money. Buyer identity is required at the AUD 1,000 threshold.

`assessHospitalityAustralianTaxInvoiceReadiness` verifies preparation, booking, recipient, issuer, pricing, fingerprints, ownership, and exact money. `issueHospitalityAustralianTaxInvoice` then allocates the tenant/jurisdiction/document-type sequence and immutable issued record in one serializable transaction. Browser input cannot choose legal money, number, issuer, recipient, tax data, sequence, issue time, or fingerprint.

Issued records remain historical evidence even after later booking changes. They are never edited to reflect a refund or commercial amendment.

## Read, PDF, and accounting projections

Authenticated issued-document reads require `booking:read` plus `payment:read`. Public reads are limited to the existing encrypted booking capability and independently verify booking ownership and an unexpired matching public principal.

Renderers revalidate immutable material columns and fingerprints before deriving customer-safe output. Deterministic server-side PDF generation uses only that verified customer projection, exact integer money, fixed A4 layout/object ordering, and no current-time/random/runtime metadata. It fails closed when legal text cannot be represented losslessly by the current WinAnsi standard-font contract; broader Unicode-safe embedded-font support remains open. See `docs/invoice-pdf.md`.

The tenant-wide invoice register is paginated. Accounting CSV generation revalidates every included invoice, uses exact decimal money strings, excludes mutable/secret/provider data, and refuses synchronous exports larger than 5,000 rows.

## Remaining production boundaries

The Phase 12 legal-document item remains open for:

- richer mixed-taxability semantics when product scope requires them;
- adjustment-note/credit/correction/void/reissue rules tied to refunds and amendments;
- universal Unicode-safe deterministic PDF rendering;
- durable re-authenticated customer history, email delivery, and resend beyond the current 24-hour recovery capability;
- explicit retention/reconciliation policy and any future accounting-provider integration;
- live issuer-registration verification if legal/product requirements demand it;
- complete Node 24/Prisma/PostgreSQL production validation; and
- jurisdiction/legal review.

## Validation boundary

Dependency-free suites cover issuer/recipient/preparation identities, Australian ABN/GST/readiness rules, issued-document integrity, accounting CSV behavior, and deterministic PDF generation. Disposable PostgreSQL suites cover tenant permissions, cross-tenant denial, issuer/preparation persistence, issuance concurrency/idempotency, stale-state rejection, and audit behavior when the guarded database harness can be executed.

Full repository and live-database validation require the supported Node 24 dependency checkout and an explicitly disposable PostgreSQL target. GitHub Actions are not used.
