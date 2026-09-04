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
8. reason-specific reachable `HospitalityIssuedAdjustmentNote` authority for full booking cancellation and decreasing commercial amendments;
9. serializable schema-versioned cancellation, first-commercial, and repeated-commercial decreasing adjustment-note issuance;
10. a persisted no-fork predecessor chain with complete server-side verification for repeated commercial decreases;
11. authenticated and capability-owned decreasing adjustment-note rendering/history through reason/chain-specific authority;
12. deterministic decreasing adjustment-note PDF projection where legal text is representable losslessly;
13. tenant registers plus bounded exact-money accounting CSV exports for tax invoices and reachable adjustment-note authority;
14. tenant-scoped live integrity reconciliation;
15. an explicit no-automatic-disposal retention rule for issued legal documents;
16. a fail-closed server readiness contract for a first AU/AUD fully taxable standard-GST increasing commercial amendment; and
17. schema-version-4 immutable evidence plus mutually exclusive database increase/decrease material columns, with increasing issuance intentionally still unreachable.

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

The reachable adjustment workflows are documented in `docs/australian-adjustment-notes.md`. Full booking cancellation remains authorized by one attributed successful full refund. Commercial decreases are authorized by the exact applied amendment plus exact immutable target pricing evidence after provider-neutral booking settlement reconciles.

Cancellation records remain schema version 1 and ordinal `1`. First commercial-amendment decrease records use schema version 2 and ordinal `1`. Repeated commercial decreases use schema version 3 / ordinal `2+`, with immutable and relational authority for the immediate predecessor.

`HospitalityIssuedAdjustmentNote` carries `predecessorAdjustmentNoteId` plus `predecessorSourceAdjustmentOrdinal` for the decreasing chain. PostgreSQL binds the predecessor to the same booking, tenant, original source invoice, adjustment reason, and exact previous ordinal; unique predecessor authority prevents forks; ordinal checks prevent gaps and self-predecessors; and schema-version-3 JSON/material-column checks bind the repeated row to its predecessor and pricing-fingerprint continuity.

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` reloads the complete decreasing commercial source chain, every applied amendment and exact target pricing record, recomputes immutable document fingerprints, and verifies chronology, price continuity, standard GST and predecessor evidence before any repeated row is accepted. For writes, an advisory lock protects chain-head selection inside the serializable repeated writer.

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` and `issueHospitalityNextCommercialAmendmentAdjustmentNote` connect this decreasing chain to the existing product route/UI without allowing the browser to select an ordinal or predecessor. New issuance requires one unique chain-derived next refund amendment; exact retries remain idempotent after the existing row is re-proven in the verified chain.

The increasing foundation is documented in `docs/australian-commercial-amendment-increasing-adjustment-readiness.md`. `assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` requires `payment:manage`, reloads the exact tenant-owned source invoice, applied `ADDITIONAL_CHARGE` amendment, immutable target pricing evidence and complete payment ledger in one serializable read, and accepts only exact AU/AUD standard-GST increases with zero prior adjustment notes.

Persistence now makes `adjustmentType` material and carries both decrease and increase effect columns under a mutually exclusive database check. Existing schema versions 1-3 remain `DECREASING`. Schema version 4 freezes a first `INCREASING / COMMERCIAL_AMENDMENT` effect with no refund/predecessor authority and exact before/after standard-GST arithmetic. There is still no schema-version-4 application writer or read/delivery support.

## Read, PDF, accounting, retention, and reconciliation projections

Authenticated issued-document reads require `booking:read` plus `payment:read`. Public reads are limited to the encrypted booking capability and independently verify booking ownership and an unexpired matching public principal.

Authenticated adjustment-note detail/register, accounting export, reconciliation and public booking-capability history currently support cancellation plus schema-version-2/3 decreasing commercial notes. Commercial rows are accepted only after membership in the complete verified decreasing source chain is proven. Public authorization occurs before chain loading, and customer projections exclude internal predecessor/amendment/target identifiers and fingerprints.

The deterministic adjustment-note PDF supports cancellation and decreasing commercial adjustment documents after the shared read boundary succeeds. Cancellation PDFs require the full-cancellation before/after price effect; commercial PDFs require `before > after` and exact `before - after = decrease`. Schema version 4 remains rejected by these application projections until increasing legal-document semantics are deliberately connected. Broader Unicode-safe embedded-font support remains open; see `docs/invoice-pdf.md`.

Tenant-wide tax-invoice and adjustment-note registers are independently paginated. Accounting CSV generation revalidates every included reachable legal document, exact decimal money strings are used, mutable/secret/provider/refund-reference data is excluded, and synchronous exports larger than 5,000 rows fail closed rather than returning partial data.

`/invoices/reconciliation` applies the same tenant authorization and validated read boundaries across the AU tax-invoice and reachable adjustment-note register, with a 5,000-document synchronous bound and before/during/after count checks so concurrent issuance cannot be reported as a stable verification. The retention/disposal boundary is documented in `docs/tax-document-retention-and-reconciliation.md`.

## Remaining production boundaries

The Phase 12 legal-document item remains open for:

- a serializable first-increasing adjustment-note writer, authenticated/public reads and delivery, accounting/reconciliation, HTML/PDF projection and reachable product action;
- cumulative/mixed-direction increasing adjustment semantics and cancellation-after-amendment semantics;
- mixed-taxability and partial/non-standard-GST adjustment rules;
- generic correction/void/reissue rules;
- universal Unicode-safe deterministic PDF rendering;
- durable re-authenticated customer history, email delivery, and resend beyond the current public recovery capability;
- a reviewed customer-data disposal/de-identification lifecycle and any future accounting-provider integration;
- live issuer-registration verification if legal/product requirements demand it;
- complete Node 24/Prisma/PostgreSQL production validation; and
- jurisdiction/legal review.

## Validation boundary

Dependency-free suites cover issuer/recipient/preparation identities, Australian ABN/GST/readiness rules, issued-document integrity, cumulative decreasing commercial-amendment readiness, first-increasing commercial-amendment readiness, schema-version-1/2/3 decreasing adjustment evidence, schema-version-4 increasing immutable evidence, shared chain-aware decreasing projection, tax-invoice/adjustment accounting CSV behavior, deterministic cancellation and decreasing commercial-amendment PDF generation, retention/reconciliation result contracts, cumulative-chain migration invariants, increasing-effect migration invariants, protected repeated decreasing issuance, and chain-aware staff/public decreasing reads.

Disposable PostgreSQL suites remain the required validation surface for tenant permissions, cross-tenant denial, schema migration behavior, composite predecessor foreign keys/no-fork constraints, mutually exclusive increasing/decreasing money constraints, issuance concurrency/idempotency, stale-state rejection, and audit behavior when the guarded database harness can be executed.

Full repository and live-database validation require the supported Node 24 dependency checkout and an explicitly disposable PostgreSQL target. GitHub Actions are not used.
