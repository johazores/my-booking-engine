# Invoice and legal pricing evidence foundation

## Status

SF has a narrow production Australian hospitality tax-document lifecycle backed by immutable commercial evidence rather than mutable booking state. The implemented chain includes append-only accepted pricing evidence, versioned issuer/recipient preparation evidence, serializable Australian tax-invoice numbering/issuance, authenticated and booking-capability reads, deterministic PDFs for the current lossless-text contract, cancellation and cumulative decreasing commercial adjustment notes, tenant accounting registers/CSV, reconciliation, and explicit retention boundaries.

The increasing-adjustment dependency has advanced beyond readiness: SF now has schema-version-4 immutable first-increasing evidence, mutually exclusive database increase/decrease columns, and a serializable idempotent server writer. That writer intentionally remains outside the product route until the shared staff/public read, accounting/reconciliation, HTML and PDF projections can independently verify schema version 4.

## Immutable booking and invoice evidence

`HospitalityBookingPricingEvidence` is append-only and tenant/booking scoped. It freezes accepted stay/scope/selections, exact currency and aggregate money, pricing fingerprint, and schema-versioned nightly/tax/fee/add-on breakdown. Confirmation and accepted commercial changes write authoritative pricing evidence inside protected transactions; SF does not reconstruct historical legal values from current mutable rate/tax configuration.

`InvoiceIssuerProfile` and `HospitalityInvoicePreparation` freeze issuer, recipient, pricing, exact money and source fingerprints. Australian invoice readiness verifies AU/AUD, the supported standard-GST contract, ABN structure and recipient requirements. `issueHospitalityAustralianTaxInvoice` allocates the tenant/jurisdiction/document sequence in a serializable transaction. Browser input cannot select legal money, issuer, recipient, tax data, number, sequence, issue time or fingerprints.

Issued tax invoices remain immutable historical evidence after later booking changes.

## Reachable adjustment authority

The reachable adjustment workflows are documented in `docs/australian-adjustment-notes.md`.

- Booking cancellation uses schema version 1 / ordinal `1` and one attributed successful full refund.
- The first decreasing commercial amendment uses schema version 2 / ordinal `1`.
- Repeated decreasing commercial amendments use schema version 3 / ordinal `2+` and bind the immediate predecessor through immutable snapshot evidence plus PostgreSQL same-tenant/same-booking/same-source/same-reason/previous-ordinal/no-fork constraints.

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` reloads the complete decreasing chain, source tax invoice, every applied amendment and exact target-pricing record, and verifies fingerprints, chronology, standard GST, price continuity and predecessor authority. Repeated writes use an advisory lock plus a serializable transaction.

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` and `issueHospitalityNextCommercialAmendmentAdjustmentNote` expose only the server-derived next decreasing commercial adjustment; the browser cannot choose direction, ordinal, predecessor, amount, GST, provider truth or sequence.

## First-increasing server writer foundation

The increasing contract is documented in `docs/australian-commercial-amendment-increasing-adjustment-readiness.md`.

`assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` requires `payment:manage` and revalidates the exact tenant-owned source invoice, one applied `ADDITIONAL_CHARGE` amendment, exactly one immutable target-pricing record, complete provider-neutral settlement, exact AU/AUD standard GST and zero prior adjustment notes.

Persistence makes `adjustmentType` material. Schema version 4 represents first-only `INCREASING / COMMERCIAL_AMENDMENT` evidence with no refund/predecessor authority, zero decrease columns and exact positive increase subtotal/GST/total columns. PostgreSQL binds the immutable JSON evidence to those material columns.

`issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` is now the authoritative server-only writer. It requires `payment:manage`, performs the legal write in a serializable transaction, rejects competing applied amendments on the same source baseline, re-runs immutable source/target/payment readiness, allocates the shared tenant `AU / ADJUSTMENT_NOTE` sequence, derives all money and issue time server-side, writes schema-version-4 evidence, immediately reparses/revalidates the created row, remains idempotent by commercial-amendment authority, and records a tenant-scoped audit event.

This writer is not imported by the current product route. Existing reads/delivery intentionally reject schema version 4 until they can prove the same authority end to end.

## Read, PDF, accounting, retention, and reconciliation projections

Authenticated reachable legal-document reads require `booking:read` plus `payment:read`. Public reads are limited to the encrypted booking capability and independently verify booking ownership and the unexpired matching principal before loading tax evidence.

Current adjustment-note detail/register/accounting/reconciliation/public history/PDF projections support cancellation and schema-version-2/3 decreasing commercial notes. Commercial rows are accepted only after membership in the complete verified decreasing source chain is proven. Customer projections exclude internal predecessor/amendment/target identifiers, provider/payment references, actors and fingerprints unless legally required.

Tenant-wide tax-invoice and adjustment-note registers are paginated. Accounting CSV revalidates included reachable legal evidence, emits exact decimal money and fails closed above 5,000 rows. `/invoices/reconciliation` applies the same tenant authorization and validated read boundaries with concurrent-register checks. Retention/disposal policy is documented in `docs/tax-document-retention-and-reconciliation.md`.

## Remaining production boundaries

Phase 12 remains open for:

- schema-version-4 authenticated/public read authority, accounting/reconciliation, HTML/PDF delivery and then direction-aware route/UI exposure;
- cumulative or mixed-direction increasing adjustments and cancellation-after-amendment semantics;
- mixed-taxability and partial/non-standard-GST adjustment rules;
- generic correction/void/reissue rules;
- universal Unicode-safe deterministic PDF rendering;
- durable re-authenticated customer history, email delivery and resend;
- reviewed customer-data disposal/de-identification and future accounting-provider integration;
- live issuer-registration verification if required;
- complete Node 24/Prisma/PostgreSQL production validation; and
- jurisdiction/legal review.

## Validation boundary

Dependency-free suites cover issuer/recipient/preparation identities, Australian tax-invoice readiness, decreasing cumulative adjustment chains, first-increasing readiness, schema-version-4 immutable evidence and migration invariants, protected decreasing issuance/read projections, accounting/PDF/reconciliation contracts, and the server-only increasing writer source boundary including authorization, serializable retry behavior, shared sequence allocation, ambiguity rejection, settlement revalidation, material increase persistence, idempotency and audit data.

Disposable PostgreSQL execution remains required for tenant permissions, cross-tenant denial, migration constraints, sequence/issuance concurrency, idempotency, stale-state rejection and audit behavior. Full repository validation requires the supported Node 24 dependency checkout and an explicitly disposable PostgreSQL target. GitHub Actions are not used.
