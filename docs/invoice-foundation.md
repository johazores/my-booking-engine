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
8. a narrow full-cancellation decreasing-adjustment issuance lifecycle with immutable `HospitalityIssuedAdjustmentNote` evidence;
9. reason-specific adjustment-note persistence that can also bind the exact first commercial amendment and immutable target pricing evidence without inventing one refund row;
10. authenticated and capability-owned cancellation adjustment-note rendering plus deterministic PDF projection;
11. tenant registers plus bounded exact-money accounting CSV exports for tax invoices and currently supported cancellation adjustment notes; and
12. tenant-scoped live integrity reconciliation plus an explicit no-automatic-disposal retention rule for issued legal documents.

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

The current issued adjustment workflow is documented in `docs/australian-adjustment-notes.md`. It supports a verified source tax invoice followed by full booking cancellation and one attributed successful full refund. SF creates a separate `AU / ADJUSTMENT_NOTE` number and immutable document rather than rewriting the original invoice.

The adjustment-note persistence model is now reason-specific. Existing schema-version-1 cancellation records keep one exact refund authority. The prepared schema-version-2 `COMMERCIAL_AMENDMENT` contract instead binds the exact amendment and immutable target pricing evidence with no refund transaction field, plus a `sourceAdjustmentOrdinal` fixed at `1`. PostgreSQL composite foreign keys bind source invoice, refund/amendment, and target evidence to the same booking and tenant.

The commercial-amendment readiness contract is documented in `docs/australian-commercial-amendment-adjustment-readiness.md`. It can prove the first post-invoice applied decreasing amendment when immutable before/after pricing evidence, standard GST, amendment-owned settlement, chronology, tenant scope, and source-invoice baseline reconcile. The corresponding immutable schema-version-2 snapshot contract is implemented, but commercial-amendment issuance and customer projections are still closed.

## Read, PDF, accounting, retention, and reconciliation projections

Authenticated issued-document reads require `booking:read` plus `payment:read`. Public reads are limited to the existing encrypted booking capability and independently verify booking ownership and an unexpired matching public principal.

Current adjustment-note rendering, PDF, public recovery, register, and accounting projections explicitly select `BOOKING_CANCELLATION`. They cannot accidentally parse a schema-version-2 commercial-amendment document with cancellation semantics. The cancellation issuance service also refuses to issue when any adjustment already exists for the source invoice.

Renderers revalidate immutable material columns and fingerprints before deriving customer-safe output. Deterministic server-side PDF generation uses only verified customer projections, exact integer money, fixed A4 layout/object ordering, and no current-time/random/runtime metadata. It fails closed when legal text cannot be represented losslessly by the current WinAnsi standard-font contract; broader Unicode-safe embedded-font support remains open. See `docs/invoice-pdf.md`.

The tenant-wide tax-invoice and current cancellation adjustment-note registers are independently paginated. Accounting CSV generation revalidates every included legal document, exact decimal money strings are used, mutable/secret/provider/refund-reference data is excluded, and synchronous exports larger than 5,000 rows fail closed rather than returning partial data.

`/invoices/reconciliation` applies the same tenant authorization and validated read boundaries across the current connected AU register, with a 5,000-document synchronous bound and before/during/after count checks so concurrent issuance cannot be reported as a stable verification. The retention/disposal boundary is documented in `docs/tax-document-retention-and-reconciliation.md`.

## Remaining production boundaries

The Phase 12 legal-document item remains open for:

- serializable commercial-amendment adjustment-note issuance using the new exact authority columns and schema-version-2 snapshot;
- authenticated/public read, deterministic PDF, accounting, and reconciliation support for that commercial-amendment document after issuance exists;
- partial/multiple/cumulative adjustment semantics, mixed taxability, and generic correction/void/reissue rules;
- universal Unicode-safe deterministic PDF rendering;
- durable re-authenticated customer history, email delivery, and resend beyond the current public recovery capability;
- a reviewed customer-data disposal/de-identification lifecycle and any future accounting-provider integration;
- live issuer-registration verification if legal/product requirements demand it;
- complete Node 24/Prisma/PostgreSQL production validation; and
- jurisdiction/legal review.

## Validation boundary

Dependency-free suites cover issuer/recipient/preparation identities, Australian ABN/GST/readiness rules, issued-document integrity, commercial-amendment decreasing-adjustment readiness, the schema-version-2 commercial-amendment adjustment snapshot, tax-invoice and cancellation adjustment accounting CSV behavior, deterministic PDF generation, and the retention/reconciliation result contract.

Disposable PostgreSQL suites remain the required validation surface for tenant permissions, cross-tenant denial, schema migration behavior, issuance concurrency/idempotency, stale-state rejection, and audit behavior when the guarded database harness can be executed.

Full repository and live-database validation require the supported Node 24 dependency checkout and an explicitly disposable PostgreSQL target. GitHub Actions are not used.
