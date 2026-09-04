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
8. reason-specific `HospitalityIssuedAdjustmentNote` authority for full booking cancellation and the first supported decreasing commercial amendment;
9. serializable cancellation and commercial-amendment adjustment-note issuance with immutable schema-versioned evidence;
10. authenticated and capability-owned adjustment-note rendering/history for both current adjustment reasons;
11. deterministic adjustment-note PDF projection for both current reasons where legal text is representable losslessly;
12. tenant registers plus bounded exact-money accounting CSV exports for tax invoices and both current adjustment-note authorities; and
13. tenant-scoped live integrity reconciliation plus an explicit no-automatic-disposal retention rule for issued legal documents.

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

The issued adjustment workflows are documented in `docs/australian-adjustment-notes.md`. Full booking cancellation remains authorized by one attributed successful full refund. The first supported decreasing commercial amendment is authorized instead by the exact applied amendment plus its exact immutable target pricing evidence after the provider-neutral booking settlement reconciles.

Existing cancellation records remain schema version 1 and keep one exact refund authority. Commercial-amendment records use schema version 2 and bind `commercialAmendmentId` + `targetPricingEvidenceId` with no synthetic refund id. `sourceAdjustmentOrdinal` is fixed to `1`; there is no predecessor chain or cumulative baseline yet. PostgreSQL composite foreign keys bind source invoice and reason-specific authority to the same booking and tenant.

The commercial readiness and issuance contract is documented in `docs/australian-commercial-amendment-adjustment-readiness.md`. Issuance re-runs the complete readiness evidence inside a serializable write, allocates the shared adjustment-note sequence, fingerprints the immutable schema-version-2 snapshot, persists exact authority, writes a safe audit event, and is idempotent by commercial-amendment authority.

## Read, PDF, accounting, retention, and reconciliation projections

Authenticated issued-document reads require `booking:read` plus `payment:read`. Public reads are limited to the existing encrypted booking capability and independently verify booking ownership and an unexpired matching public principal.

Authenticated adjustment-note detail/register and public booking-capability history support cancellation and commercial-amendment notes. They validate the immutable adjustment row/snapshot/fingerprint, revalidate the complete source tax invoice, then revalidate the reason-specific refund or commercial-amendment/target-pricing authority server-side.

The deterministic adjustment-note PDF supports both current adjustment reasons. Cancellation PDFs require the full-cancellation before/after price effect; commercial-amendment PDFs require `before > after` and an exact `before - after = decrease` price effect. Authenticated and public PDF routes consume only the already verified legal-document projection. Broader Unicode-safe embedded-font support remains open; see `docs/invoice-pdf.md`.

Tenant-wide tax-invoice and adjustment-note registers are independently paginated. Accounting CSV generation revalidates every included legal document, exact decimal money strings are used, mutable/secret/provider/refund-reference data is excluded, and synchronous exports larger than 5,000 rows fail closed rather than returning partial data.

`/invoices/reconciliation` applies the same tenant authorization and validated read boundaries across the full current AU tax-invoice and adjustment-note register, with a 5,000-document synchronous bound and before/during/after count checks so concurrent issuance cannot be reported as a stable verification. The retention/disposal boundary is documented in `docs/tax-document-retention-and-reconciliation.md`.

## Remaining production boundaries

The Phase 12 legal-document item remains open for:

- partial/multiple/cumulative adjustment semantics, mixed taxability, and generic correction/void/reissue rules;
- universal Unicode-safe deterministic PDF rendering;
- durable re-authenticated customer history, email delivery, and resend beyond the current public recovery capability;
- a reviewed customer-data disposal/de-identification lifecycle and any future accounting-provider integration;
- live issuer-registration verification if legal/product requirements demand it;
- complete Node 24/Prisma/PostgreSQL production validation; and
- jurisdiction/legal review.

## Validation boundary

Dependency-free suites cover issuer/recipient/preparation identities, Australian ABN/GST/readiness rules, issued-document integrity, commercial-amendment decreasing-adjustment readiness, schema-version-2 commercial adjustment evidence, shared adjustment document projection, tax-invoice/adjustment accounting CSV behavior, deterministic cancellation and commercial-amendment PDF generation, and the retention/reconciliation result contract.

Disposable PostgreSQL suites remain the required validation surface for tenant permissions, cross-tenant denial, schema migration behavior, issuance concurrency/idempotency, stale-state rejection, and audit behavior when the guarded database harness can be executed.

Full repository and live-database validation require the supported Node 24 dependency checkout and an explicitly disposable PostgreSQL target. GitHub Actions are not used.
