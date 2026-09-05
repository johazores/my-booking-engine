# Invoice and legal pricing evidence foundation

## Status

SF has a narrow Australian hospitality tax-document lifecycle backed by immutable commercial evidence rather than mutable booking state. It includes append-only accepted pricing evidence, versioned issuer/recipient preparation evidence, serializable tax-invoice numbering/issuance, direction-aware cumulative commercial adjustment notes, pre-amendment and post-amendment full-cancellation adjustment notes, tenant accounting registers/CSV, reconciliation, deterministic PDFs for the current lossless-text contract, and explicit retention boundaries.

The browser cannot select legal direction, ordinal, predecessor, refund set, or legal money.

## Immutable booking and invoice evidence

`HospitalityBookingPricingEvidence` is append-only and tenant/booking scoped. It freezes accepted stay/scope/selections, exact currency and aggregate money, pricing fingerprint, and schema-versioned nightly/tax/fee/add-on breakdown. Confirmation and accepted commercial changes write authoritative pricing evidence inside protected transactions.

`InvoiceIssuerProfile` and `HospitalityInvoicePreparation` freeze issuer, recipient, pricing, exact money, and preparation fingerprint. Australian readiness verifies AU/AUD, the supported standard-GST contract, ABN structure, and recipient requirements. `issueHospitalityAustralianTaxInvoice` allocates the tenant/jurisdiction/document sequence in a serializable transaction. Issued tax invoices remain immutable after later booking changes.

## Adjustment authority

- booking cancellation before commercial changes: schema 1 / ordinal `1`;
- first decreasing commercial amendment: schema 2 / ordinal `1`;
- repeated decreasing commercial amendment: schema 3 / ordinal `2+`, including an increasing predecessor;
- first increasing commercial amendment: schema 4 / ordinal `1`;
- repeated increasing commercial amendment: schema 5 / ordinal `2+`; and
- terminal booking cancellation after a verified commercial chain: schema 6 / ordinal `2+`, bound to the immediate predecessor plus an ordered exact refund-authority set.

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` verifies complete commercial history across schemas 2 through 5 and both directions. It re-proves immutable source invoice/amendment/target pricing, predecessor continuity, chronology, standard-GST effect, and provider-neutral settlement at each document issue time. Repeated writes select the verified head under a tenant/booking/source advisory lock.

Historical commercial reads permit exactly one structurally terminal cancellation after the commercial chain, while the write selector remains strict. Schema-version-6 authority separately re-proves that terminal document's predecessor, issue-time payment ledger, zero settlement, exact ordered refund set, source invoice, parties, money, and fingerprints.

## Product issuance boundary

Commercial product orchestration requires `payment:manage`, tenant/booking/source authority, derives direction from persisted amendments, and rejects current-baseline ambiguity. Supported commercial directions may alternate while every new step begins at the verified legal head.

Terminal cancellation availability also requires `payment:manage` and is evaluated before any further commercial action. Schema-version-6 issuance derives the current legal price from the verified commercial head, derives the exact successful refund set from provider-neutral payment truth, and derives ordinal, predecessor, GST, numbering, fingerprint, and issue time server-side. Once the cancellation is issued the commercial write path remains closed.

## Read, PDF, accounting, retention, and reconciliation projections

Authenticated legal-document reads require `booking:read` plus `payment:read`. Public reads verify tenant slug, encrypted booking capability, persisted booking ownership, an unexpired principal, and the tenant-owned booking before loading evidence.

`hospitality-issued-adjustment-note-authority-service.ts` centralizes immutable row/document verification for schema-version-1 cancellation, schema-version-6 terminal cancellation, and schema-version-2-through-5 commercial adjustments. Staff detail/register/accounting, reconciliation, public history, HTML, and deterministic PDF delivery therefore consume one shared validated document boundary.

Customer projections exclude internal predecessor/amendment/target IDs, provider/payment/refund references, actors, and fingerprints unless legally required. Accounting CSV emits exact decimal money with explicit direction and separate decrease/increase columns. `/invoices/reconciliation` uses the same validated tenant-scoped read boundaries and concurrent-register checks.

## Remaining production boundaries

Phase 12 remains open for:

- mixed-taxability and partial/non-standard-GST adjustment rules;
- generic correction/void/reissue rules;
- universal Unicode-safe deterministic PDF rendering;
- durable re-authenticated customer history, email delivery, and resend;
- reviewed customer-data disposal/de-identification and future accounting-provider integration;
- live issuer-registration verification if required;
- complete Node 24/Prisma/PostgreSQL production validation; and
- jurisdiction/legal review.

## Validation boundary

Dependency-free suites cover the Australian tax-invoice foundation, direction-aware cumulative commercial chains, increase-to-decrease behavior, terminal cancellation readiness/snapshots/read authority/writer/product orchestration, protected staff/public projections, accounting/PDF/reconciliation contracts, and fail-closed boundaries. Disposable PostgreSQL execution remains required for live tenant permissions, constraints, sequence/concurrency, idempotency, stale-state rejection, and audit behavior. GitHub Actions are not used.
