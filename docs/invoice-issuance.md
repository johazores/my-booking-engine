# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, PDF projection, adjustment documents, accounting export and delivery so browser input or mutable booking/customer data never becomes legal-document authority by accident.

The Australian foundation supports tax invoices, full-cancellation decreasing adjustment notes, first/repeated commercial-amendment decreases, first increasing commercial-amendment adjustments, and supported repeated increasing adjustments under the narrow AU/AUD fully taxable standard-GST contract.

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

`hospitality-commercial-amendment-adjustment-product-service.ts` is the product-facing direction-aware boundary. It validates tenant/user/booking/source identifiers, requires `payment:manage`, verifies existing commercial history through the complete tenant/source legal chain, and derives legal direction only from persisted commercial-amendment evidence.

The boundary preserves cancellation priority. When no increasing adjustment exists, it first asks the complete decreasing-chain readiness for a unique `REFUND` candidate. For an empty chain it can use the first-increasing readiness. For an existing verified commercial chain with no supported next decrease, it uses `getHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNoteAvailability` to select exactly one `ADDITIONAL_CHARGE` against the chain-head after-price. That availability re-parses target evidence, re-derives provider-neutral settlement, re-runs cumulative increasing readiness, and checks the server-derived ordinal/predecessor against the verified head before the action is exposed.

The protected route supplies organization/user context and route amendment id. Its request body contains only `sourceInvoiceDocumentNumber`. The browser cannot send adjustment direction, GST, money, currency, provider truth, settlement state, parties, ABN, ordinal, predecessor, sequence, issue time or fingerprints.

The tax-invoice action receives `adjustmentType` and `sourceAdjustmentOrdinal` from the server solely for direction-correct labeling and chain-position confirmation; it does not send either value back as authority.

## Decreasing commercial-amendment issuance

The decreasing chain adapter derives the current legal baseline from the complete verified predecessor set. It requires one unambiguous applied `REFUND` amendment, exact target pricing, standard-GST reconciliation, chronology and complete settlement. First writes use schema version 2. Repeated writes use schema version 3 after selecting the verified chain head under an advisory lock and serializable transaction.

Exact decreasing retries prove the persisted document belongs to the verified source chain before returning.

## Increasing commercial-amendment issuance

First-increasing readiness requires one tenant-owned source invoice, one exact applied `ADDITIONAL_CHARGE` amendment, one immutable target-pricing record, positive standard-GST effect, complete provider-neutral settlement, chronology, source-baseline uniqueness and zero existing adjustment notes.

`issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` is the serializable schema-version-4 writer. It rechecks the immutable legal/commercial authority, rejects competing refund/additional-charge amendments on the same source baseline, allocates the shared adjustment-note sequence, derives all legal money and issue time server-side, revalidates persisted snapshot/material evidence, remains idempotent by commercial-amendment authority and records the audit.

Repeated-increasing readiness requires a complete verified predecessor price chain, exact current legal baseline, predecessor chronology, immutable target evidence, positive standard-GST effect and fully reconciled additional-charge settlement. Schema version 5 freezes the immediate predecessor identity/fingerprint and pricing continuity. `issueHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNote` uses the locked verified chain head, repeats ambiguity/readiness/settlement checks in its serializable transaction, reloads the chain after persistence, and remains fail closed on competing baseline authority.

The product service dispatches increasing ordinal `1` to the schema-version-4 writer and server-derived ordinal `2+` to the schema-version-5 writer. It does not accept ordinal or predecessor from the caller. Decrease-after-increase remains closed.

## Authenticated and customer projections

Authenticated staff tax-document reads require `booking:read` plus `payment:read`; issuance requires `payment:manage`. Public reads first prove tenant slug, capability, ownership, unexpired principal and tenant-owned booking.

`hospitality-issued-adjustment-note-authority-service.ts` verifies cancellation authority and sends every commercial row — schema versions 2 through 5, decreasing or increasing — through the complete source-chain verifier. Adjustment detail/register, accounting CSV, reconciliation, authenticated/public HTML and deterministic PDF delivery all inherit this shared boundary. Public customer-safe outputs exclude internal predecessor/amendment/target ids, fingerprints, actors and provider/payment/refund references unless legally required.

## Remaining production boundary

Decrease-after-increase and other unsupported direction-transition rules, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustment rules, generic reissue/void/correction, durable re-authenticated customer history, email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL production validation and jurisdiction/legal review remain separate work.
