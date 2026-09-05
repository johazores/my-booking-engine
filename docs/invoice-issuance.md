# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, PDF projection, adjustment documents, accounting export and delivery so browser input or mutable booking/customer data never becomes legal-document authority by accident.

The Australian foundation supports tax invoices, full-cancellation decreasing adjustment notes, first/repeated commercial-amendment decreases, the first supported commercial-amendment increase, and a server-only repeated-increasing writer under the narrow AU/AUD fully taxable standard-GST contract.

## Persistence

`HospitalityInvoicePreparation` freezes accepted pricing evidence, issuer fingerprint, recipient snapshot/fingerprint, exact money and preparation fingerprint. `HospitalityInvoiceNumberSequence` owns the next integer sequence by tenant, jurisdiction and document type. `HospitalityIssuedInvoice` stores immutable tax-invoice identity/evidence.

`HospitalityIssuedAdjustmentNote` is direction-, reason- and schema-specific:

- schema version 1 / `DECREASING / BOOKING_CANCELLATION`: one exact refund authority, ordinal `1`;
- schema version 2 / first `DECREASING / COMMERCIAL_AMENDMENT`: exact amendment + target-pricing authority, ordinal `1`;
- schema version 3 / repeated `DECREASING / COMMERCIAL_AMENDMENT`: exact amendment + target pricing + immediate predecessor, ordinal `2+`;
- schema version 4 / first `INCREASING / COMMERCIAL_AMENDMENT`: exact applied additional-charge amendment + target pricing, zero decrease and exact positive increase columns, no predecessor/refund authority, ordinal `1`; and
- schema version 5 / repeated `INCREASING / COMMERCIAL_AMENDMENT`: exact positive increase plus immutable immediate-predecessor authority, ordinal `2+`.

PostgreSQL constrains material direction/effect and predecessor integrity independently of application checks. The latest snapshot constraint preserves schema versions 1 through 4 and admits schema version 5 only when the repeated-increasing predecessor ordinal and snapshot/material authority reconcile.

## Tax-invoice and cancellation issuance

`issueHospitalityAustralianTaxInvoice` requires `payment:manage`, revalidates preparation/recipient/issuer/pricing evidence and accepted booking commercial state, then derives sequence, number, issue time, legal snapshot and fingerprint server-side.

`issueHospitalityCancellationAdjustmentNote` requires `payment:manage`, verifies source invoice, cancellation/refund state, one exact attributed successful full refund and immutable money. It refuses issuance when another legal adjustment already exists for the source invoice.

## Commercial-amendment product orchestration

`hospitality-commercial-amendment-adjustment-product-service.ts` is the product-facing direction-aware boundary. It validates tenant/user/booking/source identifiers, requires `payment:manage`, and derives the legal direction from persisted commercial-amendment evidence.

The boundary preserves cancellation priority. For commercial amendments it first asks the existing complete decreasing-chain readiness for a unique `REFUND` candidate. When there is no existing legal adjustment chain and no supported decreasing candidate, it asks the first-increasing readiness for a unique `ADDITIONAL_CHARGE` candidate. It checks the selected persisted baseline for competing applied amendments across both directions before exposing the action.

The protected route supplies organization/user context and route amendment id. Its request body contains only `sourceInvoiceDocumentNumber`. The browser cannot send adjustment direction, GST, money, currency, provider truth, settlement state, parties, ABN, ordinal, predecessor, sequence, issue time or fingerprints.

The tax-invoice action receives `adjustmentType` from the server solely for direction-correct labeling and confirmation copy; it does not send that direction back as authority.

## Decreasing commercial-amendment issuance

The decreasing chain adapter derives the current legal baseline from the complete verified predecessor set. It requires one unambiguous applied `REFUND` amendment, exact target pricing, standard-GST reconciliation, chronology and complete settlement. First writes use schema version 2. Repeated writes use schema version 3 after selecting the verified chain head under an advisory lock and serializable transaction.

Exact decreasing retries prove the persisted document belongs to the verified source chain before returning through the appropriate idempotent writer.

## Increasing commercial-amendment issuance

First-increasing readiness requires one tenant-owned source invoice, one exact applied `ADDITIONAL_CHARGE` amendment, one immutable target-pricing record, positive standard-GST effect, complete provider-neutral settlement, chronology, source-baseline uniqueness and zero existing adjustment notes.

`issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` is the serializable schema-version-4 writer. It rechecks the immutable legal/commercial authority, rejects competing refund/additional-charge amendments on the same source baseline, allocates the shared adjustment-note sequence, derives all legal money and issue time server-side, revalidates persisted snapshot/material evidence, remains idempotent by commercial-amendment authority and records the audit.

Repeated-increasing readiness requires a complete verified predecessor price chain, exact current legal baseline, predecessor chronology, immutable target evidence, positive standard-GST effect and fully reconciled additional-charge settlement. Schema version 5 freezes the immediate predecessor identity/fingerprint and pricing continuity. `issueHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNote` implements that contract in a serializable server-only writer, uses the locked verified chain head, reloads the complete chain after persistence and remains fail closed on competing baseline authority.

The repeated writer is intentionally not imported by the product service yet. An existing increasing document therefore remains terminal in the reachable product path even though schema-version-5 write/read/delivery authority now exists server-side.

## Authenticated and customer projections

Authenticated staff tax-document reads require `booking:read` plus `payment:read`; issuance requires `payment:manage`. Public reads first prove tenant slug, capability, ownership, unexpired principal and tenant-owned booking.

`hospitality-issued-adjustment-note-authority-service.ts` now verifies cancellation authority and sends every commercial row — schema versions 2 through 5, decreasing or increasing — through the complete source-chain verifier. Adjustment detail/register, accounting CSV, reconciliation, authenticated/public HTML and deterministic PDF delivery all inherit this shared boundary. Public customer-safe outputs exclude internal predecessor/amendment/target ids, fingerprints, actors and provider/payment/refund references unless legally required.

## Remaining production boundary

The next issuance dependency is product-reachable repeated increasing: server availability must select the unique applied `ADDITIONAL_CHARGE` against the verified current chain head and then call the schema-version-5 writer without accepting direction/ordinal/predecessor from the browser. Decrease-after-increase and broader mixed-direction lifecycle rules, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustment rules, generic reissue/void/correction, durable re-authenticated customer history, email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL production validation and jurisdiction/legal review remain separate work.
