# Invoice and legal pricing evidence foundation

## Status

SF has a narrow production Australian hospitality tax-document lifecycle backed by immutable commercial evidence rather than mutable booking state. It includes append-only accepted pricing evidence, versioned issuer/recipient preparation evidence, serializable tax-invoice numbering/issuance, cancellation and cumulative decreasing commercial adjustment notes, first-increasing commercial adjustment-note issuance/read-delivery authority, a repeated-increasing readiness/persistence foundation, tenant accounting registers/CSV, reconciliation, deterministic PDFs for the current lossless-text contract and explicit retention boundaries.

Schema-version-4 `INCREASING / COMMERCIAL_AMENDMENT` evidence is product-reachable only through direction-aware server orchestration. Schema version 5 now defines repeated-increasing predecessor evidence but has no reachable writer/read projection yet. The browser cannot select legal direction or legal money.

## Immutable booking and invoice evidence

`HospitalityBookingPricingEvidence` is append-only and tenant/booking scoped. It freezes accepted stay/scope/selections, exact currency and aggregate money, pricing fingerprint and schema-versioned nightly/tax/fee/add-on breakdown. Confirmation and accepted commercial changes write authoritative pricing evidence inside protected transactions; historical values are not reconstructed from mutable rate/tax configuration.

`InvoiceIssuerProfile` and `HospitalityInvoicePreparation` freeze issuer, recipient, pricing, exact money and preparation fingerprint. Australian invoice readiness verifies AU/AUD, the supported standard-GST contract, ABN structure and recipient requirements. `issueHospitalityAustralianTaxInvoice` allocates the tenant/jurisdiction/document sequence in a serializable transaction. Issued tax invoices remain immutable after later booking changes.

## Adjustment authority

- booking cancellation: schema version 1 / ordinal `1`;
- first decreasing commercial amendment: schema version 2 / ordinal `1`;
- repeated decreasing commercial amendment: schema version 3 / ordinal `2+` with immediate-predecessor authority;
- first increasing commercial amendment: schema version 4 / ordinal `1`, exact `ADDITIONAL_CHARGE` amendment + target pricing, zero decrease and exact positive increase columns; and
- repeated increasing foundation: schema version 5 / ordinal `2+`, exact positive increase plus immutable immediate-predecessor authority. No production writer emits schema version 5 yet.

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` currently verifies the complete decreasing source chain and repeated writes select its head under an advisory lock. `verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows` independently re-proves first-increasing source invoice, exact applied amendment, unique target pricing, full payment ledger, sole source-adjustment authority, source-baseline uniqueness, chronology, standard GST, material columns and fingerprints. Extending those read/chain boundaries to schema version 5 is the next dependency.

## Direction-aware issuance boundary

`hospitality-commercial-amendment-adjustment-product-service.ts` is the shared product boundary for commercial-amendment adjustment notes. It requires `payment:manage`, tenant- and booking-scopes source authority, derives direction from persisted amendments, preserves the existing decreasing chain, considers first-increasing authority only with no earlier adjustment chain, and rejects same-baseline ambiguity across refund/additional-charge candidates before exposing an action.

For decreasing writes it delegates to the existing complete chain orchestration. For a supported first increase it delegates to the serializable schema-version-4 writer, which independently rechecks same-source-baseline ambiguity before persistence. Exact increasing retries are re-proved through the post-issuance verifier before the idempotent writer is called.

The route body contains only the source invoice number and the protected route supplies the amendment id. The UI receives direction only for display. Browser input cannot choose GST, amount, currency, provider truth, direction, ordinal, predecessor, sequence, issue time or fingerprints.

## Read, PDF, accounting, retention, and reconciliation projections

Authenticated legal-document reads require `booking:read` plus `payment:read`. Public reads verify tenant slug, encrypted booking capability, persisted booking ownership, an unexpired principal and the tenant-owned booking before loading tax evidence.

Adjustment detail/register/accounting/reconciliation/public history/PDF projections support cancellation, verified schema-version-2/3 decreasing commercial notes and verified schema-version-4 first-increasing notes. Schema-version-5 evidence is intentionally unreachable until the shared post-issuance verifier and every projection understand its predecessor authority. Customer projections exclude internal predecessor/amendment/target ids, provider/payment references, actors and fingerprints unless legally required.

Accounting CSV emits exact decimal money with explicit direction and separate decrease/increase columns. `/invoices/reconciliation` uses the same validated tenant-scoped read boundaries and concurrent-register checks. Retention/disposal policy is documented in `docs/tax-document-retention-and-reconciliation.md`.

Authenticated and capability-owned deterministic PDF routes consume the verified direction-aware document and reject mixed/unreconciled effects or unsupported text.

## Remaining production boundaries

Phase 12 remains open for:

- product-reachable repeated increasing and broader mixed-direction adjustment chains plus cancellation-after-amendment semantics;
- mixed-taxability and partial/non-standard-GST adjustment rules;
- generic correction/void/reissue rules;
- universal Unicode-safe deterministic PDF rendering;
- durable re-authenticated customer history, email delivery and resend;
- reviewed customer-data disposal/de-identification and future accounting-provider integration;
- live issuer-registration verification if required;
- complete Node 24/Prisma/PostgreSQL production validation; and
- jurisdiction/legal review.

## Validation boundary

Dependency-free suites cover the Australian tax-invoice foundation, decreasing cumulative chains, first-increasing readiness/persistence/writer/read authority, repeated-increasing readiness/schema-v5 persistence contracts, direction-aware product issuance source contracts, protected staff/public projections, accounting/PDF/reconciliation contracts and fail-closed boundaries. Disposable PostgreSQL execution remains required for live tenant permissions, constraints, sequence/concurrency, idempotency, stale-state rejection and audit behavior. GitHub Actions are not used.