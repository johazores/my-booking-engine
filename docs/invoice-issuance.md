# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, PDF projection, adjustment documents, accounting export and delivery so browser input or mutable booking/customer data never becomes legal-document authority by accident.

The Australian foundation supports tax invoices, full-cancellation decreasing adjustment notes, and direction-aware first/repeated commercial-amendment adjustments under the narrow AU/AUD fully taxable standard-GST contract.

## Persistence

`HospitalityInvoicePreparation` freezes accepted pricing evidence, issuer fingerprint, recipient snapshot/fingerprint, exact money and preparation fingerprint. `HospitalityInvoiceNumberSequence` owns the next integer sequence by tenant, jurisdiction and document type. `HospitalityIssuedInvoice` stores immutable tax-invoice identity/evidence.

`HospitalityIssuedAdjustmentNote` is direction-, reason- and schema-specific:

- schema version 1 / `DECREASING / BOOKING_CANCELLATION`: one exact refund authority, ordinal `1`;
- schema version 2 / first `DECREASING / COMMERCIAL_AMENDMENT`: exact amendment + target-pricing authority, ordinal `1`;
- schema version 3 / repeated `DECREASING / COMMERCIAL_AMENDMENT`: exact amendment + target pricing + immediate predecessor, ordinal `2+`, including an increasing predecessor;
- schema version 4 / first `INCREASING / COMMERCIAL_AMENDMENT`: exact applied additional-charge amendment + target pricing, zero decrease and exact positive increase columns, no predecessor/refund authority, ordinal `1`; and
- schema version 5 / repeated `INCREASING / COMMERCIAL_AMENDMENT`: exact positive increase plus immutable immediate-predecessor authority, ordinal `2+`.

PostgreSQL constrains material direction/effect and predecessor integrity independently of application checks. The latest snapshot constraint preserves schema versions 1 through 4 and admits schema version 5 only when the repeated-increasing predecessor ordinal and snapshot/material authority reconcile.

## Tax-invoice and cancellation issuance

`issueHospitalityAustralianTaxInvoice` requires `payment:manage`, revalidates preparation/recipient/issuer/pricing evidence and accepted booking commercial state, then derives sequence, number, issue time, legal snapshot and fingerprint server-side.

`issueHospitalityCancellationAdjustmentNote` requires `payment:manage`, verifies source invoice, cancellation/refund state, one exact attributed successful full refund and immutable money. It refuses issuance when another legal adjustment already exists for the source invoice.

## Commercial-amendment product orchestration

`hospitality-commercial-amendment-adjustment-product-service.ts` is the product-facing direction-aware boundary. It validates tenant/user/booking/source identifiers, requires `payment:manage`, verifies existing commercial history through the complete tenant/source legal chain, and derives legal direction only from persisted commercial-amendment evidence.

The boundary preserves cancellation priority. It evaluates the complete decreasing-chain readiness against the current legal baseline whether the verified commercial head is decreasing or increasing. If exactly one supported `REFUND` is ready, the product boundary confirms there is no competing current-baseline refund/additional-charge amendment before exposing it. For an empty chain it can instead use first-increasing readiness when no decrease is ready. For an existing verified commercial chain with no supported next decrease, it uses `getHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNoteAvailability` to select exactly one `ADDITIONAL_CHARGE` against the chain-head after-price.

Same-baseline ambiguity checks are anchored to the current verified chain-head issue time. Historical amendments applied before the current legal baseline cannot compete merely because a later mixed-direction chain returns to the same amount/fingerprint.

The protected route supplies organization/user context and route amendment id. Its request body contains only `sourceInvoiceDocumentNumber`. The browser cannot send adjustment direction, GST, money, currency, provider truth, settlement state, parties, ABN, ordinal, predecessor, sequence, issue time or fingerprints.

The tax-invoice action receives `adjustmentType` and `sourceAdjustmentOrdinal` from the server solely for direction-correct labeling and chain-position confirmation; it does not send either value back as authority.

## Decreasing commercial-amendment issuance

The decreasing chain adapter derives the current legal baseline from the complete verified predecessor set. It requires one unambiguous applied `REFUND` amendment, exact target pricing, standard-GST reconciliation, chronology and complete settlement. First writes use schema version 2. Repeated writes use schema version 3 after selecting the verified chain head under an advisory lock and serializable transaction.

A repeated decrease may follow a decreasing or increasing predecessor. The readiness domain treats prior verified steps direction-neutrally for standard-GST price continuity, while the shared chain verifier independently proves each predecessor's persisted direction/schema, immutable target evidence, chronology and settlement. The current candidate itself remains strictly decreasing.

Exact decreasing retries prove the persisted document belongs to the verified source chain before returning.

## Increasing commercial-amendment issuance

First-increasing readiness requires one tenant-owned source invoice, one exact applied `ADDITIONAL_CHARGE` amendment, one immutable target-pricing record, positive standard-GST effect, complete provider-neutral settlement, chronology, source-baseline uniqueness and zero existing adjustment notes.

`issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` is the serializable schema-version-4 writer. It rechecks the immutable legal/commercial authority, rejects competing refund/additional-charge amendments on the same source baseline, allocates the shared adjustment-note sequence, derives all legal money and issue time server-side, revalidates persisted snapshot/material evidence, remains idempotent by commercial-amendment authority and records the audit.

Repeated-increasing readiness requires a complete verified predecessor price chain, exact current legal baseline, predecessor chronology, immutable target evidence, positive standard-GST effect and fully reconciled additional-charge settlement. Schema version 5 freezes the immediate predecessor identity/fingerprint and pricing continuity. `issueHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNote` uses the locked verified chain head, repeats ambiguity/readiness/settlement checks in its serializable transaction, reloads the chain after persistence, and remains fail closed on competing baseline authority.

The product service dispatches decreasing ordinal `1`/`2+` to schema versions 2/3 and increasing ordinal `1`/`2+` to schema versions 4/5. It does not accept direction, ordinal or predecessor from the caller.

## Authenticated and customer projections

Authenticated staff tax-document reads require `booking:read` plus `payment:read`; issuance requires `payment:manage`. Public reads first prove tenant slug, capability, ownership, unexpired principal and tenant-owned booking.

`hospitality-issued-adjustment-note-authority-service.ts` verifies cancellation authority and sends every commercial row — schema versions 2 through 5, decreasing or increasing — through the complete source-chain verifier. Adjustment detail/register, accounting CSV, reconciliation, authenticated/public HTML and deterministic PDF delivery all inherit this shared boundary. Public customer-safe outputs exclude internal predecessor/amendment/target ids, fingerprints, actors and provider/payment/refund references unless legally required.

## Remaining production boundary

Cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustment rules, generic reissue/void/correction, durable re-authenticated customer history, email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL production validation and jurisdiction/legal review remain separate work.
