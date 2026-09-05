# Invoice and legal pricing evidence foundation

## Status

SF has a narrow production Australian hospitality tax-document lifecycle backed by immutable commercial evidence rather than mutable booking state. It includes append-only accepted pricing evidence, versioned issuer/recipient preparation evidence, serializable tax-invoice numbering/issuance, cancellation and cumulative decreasing commercial adjustment notes, first/repeated increasing commercial adjustment-note issuance, tenant accounting registers/CSV, reconciliation, deterministic PDFs for the current lossless-text contract and explicit retention boundaries.

Schema-version-4 `INCREASING / COMMERCIAL_AMENDMENT` evidence is used for the first increasing adjustment. Schema version 5 is product-reachable only through server-derived verified chain-head availability and the serializable repeated-increasing writer. The browser cannot select legal direction, ordinal, predecessor or legal money.

## Immutable booking and invoice evidence

`HospitalityBookingPricingEvidence` is append-only and tenant/booking scoped. It freezes accepted stay/scope/selections, exact currency and aggregate money, pricing fingerprint and schema-versioned nightly/tax/fee/add-on breakdown. Confirmation and accepted commercial changes write authoritative pricing evidence inside protected transactions; historical values are not reconstructed from mutable rate/tax configuration.

`InvoiceIssuerProfile` and `HospitalityInvoicePreparation` freeze issuer, recipient, pricing, exact money and preparation fingerprint. Australian invoice readiness verifies AU/AUD, the supported standard-GST contract, ABN structure and recipient requirements. `issueHospitalityAustralianTaxInvoice` allocates the tenant/jurisdiction/document sequence in a serializable transaction. Issued tax invoices remain immutable after later booking changes.

## Adjustment authority

- booking cancellation: schema version 1 / ordinal `1`;
- first decreasing commercial amendment: schema version 2 / ordinal `1`;
- repeated decreasing commercial amendment: schema version 3 / ordinal `2+` with immediate-predecessor authority;
- first increasing commercial amendment: schema version 4 / ordinal `1`, exact `ADDITIONAL_CHARGE` amendment + target pricing, zero decrease and exact positive increase columns; and
- repeated increasing commercial amendment: schema version 5 / ordinal `2+`, exact positive increase plus immutable immediate-predecessor authority.

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` verifies the complete commercial source chain across schema versions 2 through 5 and both supported directions. It re-proves immutable source invoice/amendment/target pricing, predecessor continuity, chronology, standard-GST direction/effect and the provider-neutral settlement ledger at each document issue time. Repeated writes select the verified chain head under a tenant/booking/source advisory lock.

## Direction-aware issuance boundary

`hospitality-commercial-amendment-adjustment-product-service.ts` is the shared product boundary for commercial-amendment adjustment notes. It requires `payment:manage`, tenant- and booking-scopes source authority, verifies existing commercial history through the complete legal chain, derives direction from persisted amendments, preserves decreasing priority while no increasing history exists, and rejects same-baseline ambiguity across refund/additional-charge candidates before exposing an action.

For an existing commercial chain, repeated-increasing availability derives the current baseline from the verified head, requires exactly one applied `ADDITIONAL_CHARGE`, independently validates target-pricing evidence and provider-neutral settlement, and re-runs cumulative readiness with the complete predecessor set. The product boundary dispatches first increases to schema version 4 and server-derived ordinal `2+` increases to schema version 5. Existing amendment retries return only after complete chain membership verification.

The route body contains only the source invoice number and the protected route supplies the amendment id. The UI receives direction/ordinal only for display. Browser input cannot choose GST, amount, currency, provider truth, direction, ordinal, predecessor, sequence, issue time or fingerprints.

A decreasing chain can transition to an increasing adjustment and an increasing head can continue increasing. Decrease-after-increase and cancellation-after-amendment remain fail closed.

## Read, PDF, accounting, retention, and reconciliation projections

Authenticated legal-document reads require `booking:read` plus `payment:read`. Public reads verify tenant slug, encrypted booking capability, persisted booking ownership, an unexpired principal and the tenant-owned booking before loading tax evidence.

`hospitality-issued-adjustment-note-authority-service.ts` centralizes immutable row/document verification for cancellation and commercial adjustment notes. Commercial rows of either direction are checked through the complete schema-version-2-through-5 chain verifier. Staff detail/register/accounting, reconciliation, public history, HTML and deterministic PDF delivery therefore accept schema-version-5 evidence only after the same complete chain authority proves it. Cancellation continues to independently revalidate all persisted source-invoice material plus the attributed successful full refund.

Customer projections exclude internal predecessor/amendment/target ids, provider/payment references, actors and fingerprints unless legally required. Accounting CSV emits exact decimal money with explicit direction and separate decrease/increase columns. `/invoices/reconciliation` uses the same validated tenant-scoped read boundaries and concurrent-register checks. Retention/disposal policy is documented in `docs/tax-document-retention-and-reconciliation.md`.

## Remaining production boundaries

Phase 12 remains open for:

- decrease-after-increase and other unsupported direction-transition rules plus cancellation-after-amendment semantics;
- mixed-taxability and partial/non-standard-GST adjustment rules;
- generic correction/void/reissue rules;
- universal Unicode-safe deterministic PDF rendering;
- durable re-authenticated customer history, email delivery and resend;
- reviewed customer-data disposal/de-identification and future accounting-provider integration;
- live issuer-registration verification if required;
- complete Node 24/Prisma/PostgreSQL production validation; and
- jurisdiction/legal review.

## Validation boundary

Dependency-free suites cover the Australian tax-invoice foundation, decreasing cumulative chains, first-increasing readiness/persistence/writer/read authority, repeated-increasing readiness/schema-v5 persistence/writer/product-orchestration contracts, shared direction-aware downstream read authority, protected staff/public projections, accounting/PDF/reconciliation contracts and fail-closed boundaries. Disposable PostgreSQL execution remains required for live tenant permissions, constraints, sequence/concurrency, idempotency, stale-state rejection and audit behavior. GitHub Actions are not used.
